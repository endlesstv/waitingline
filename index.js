var formidable = require("formidable");
var fs = require("fs");
var http = require("http");
var pg = require("pg");

var WAITING_LINE_PORT = 3000;
var REQUEST_METHOD_POST = "POST";
var POST_ACTIVIATE = "/activate";
var POST_SHARE = "/share";

var ERROR_NO_DEVICE_ID = new Error("A device_id is required.");
ERROR_NO_DEVICE_ID.errorCode = 400;

var ERROR_DEVICE_EXISTS = new Error("Device is already registered.");
ERROR_DEVICE_EXISTS.errorCode = 400;

var ERROR_FAILED_DATABASE_CONNECT = new Error("Failed to connect to the database.");
ERROR_FAILED_DATABASE_CONNECT.errorCode = 500;

var SETTINGS;

/**
 * We'll pulling settings from an external configuration file that is in this directory but not a
 * part of the repo. Yay password secrecy!
 *
 * @param file The full or relative path to the JSON file with the configuration for WaitingLine.
 */
var initialize = function initialize(file) {
	var fs = require("fs");
	try {
		SETTINGS = JSON.parse(fs.readFileSync(file, "utf8"));
	}
	catch (ex) {
		console.log(ex);
		console.log("FATAL: No configuration file provided. See README.");
		process.exit(1);
	}
};
exports.initialize = initialize;
initialize(__dirname + "/config.json");

/**
 * Check if the device is in the queue. If it is not in the queue, add it to the queue. The 
 * callback function for postActivate() should take an error object as its first parameter and a
 * JSON object with the keys 'place' and 'total', which contain the device's place in the queue
 * and the total number of enqueued devices, respectively.
 *
 * @param data A data form sent by a device with its information.
 * @param callback A callback function to let the HTTP server know we're done processing data.
 */
var postActivate = function postActivate(data, callback) {	
	if (!data.device_id) {
		callback(ERROR_NO_DEVICE_ID);
		return;
	}

	// Connect to the PostgreSQL database.
	pg.connect(SETTINGS.pg, function onPostgreSQLConnect(error, client, done) {
		if (error) {			
			done(client);
			callback(ERROR_FAILED_DATABASE_CONNECT);
			return;
		}

		// Attempt to insert the device into the database. If it fails, we can be reasonably
		// certain that failure is caused because of key duplication, i.e. a second attempt to
		/// register an already registered device.
		var insert_query = "INSERT INTO device (id) VALUES ($1) RETURNING priority";
		client.query(insert_query, [data.device_id], function onInsert(error, insert_result) {
			if (error) {
				done(client);
				callback(ERROR_DEVICE_EXISTS);
				return;
			}

			var place = insert_result.rows[0].priority;
			var total = place;

			// Determine the new device's place in line among the enqueued devices. We can assume
			// new devices are at the end of the queue, but existing devices may be somewhere in
			// the middle!
			var count_query = "SELECT SUM(CASE WHEN is_activated = FALSE THEN 1 END) as total,";
			count_query += " SUM(CASE WHEN is_activated = FALSE AND priority <= $1 THEN 1 END) as place";
			count_query += " FROM device";
			client.query(count_query, [place], function onCount(error, count_result) {
				if (!error) {
					place = count_result.rows[0].place;
					total = count_result.rows[0].total;
				}				
				done(client);
				callback(null, {"place": place, "total": total});
			});
		});	
	});
};
exports.postActivate = postActivate;

/**
 * Check if the device shared. If the device shared, reward the device by lowering its priority in
 * the queue.
 *
 * @param data A data form sent by a device with some information about the share attempt.
 * @param callback A callback function to let the HTTP server know we're done processing data.
 */
var postShare = function postShare(data, callback) {
	if (!data.device_id) {
		callback(ERROR_NO_DEVICE_ID);
		return;
	}

	pg.connect(SETTINGS.pg, function onPostgreSQLConnect(error, client, done) {
		if (error) {			
			done(client);
			callback(ERROR_FAILED_DATABASE_CONNECT);
			return;
		}


		done(client);
		callback();
	});
};
exports.postShare = postShare;

/**
 * Handles incoming HTTP requests.
 *
 * @param request A node.js http.ClientRequest object. Do not modify.
 * @param response A node.js http.ServerResponse object. Do not modify, always call end().
 * @param form_parser An optional object for parsing form data that is injected during testing.
 */
var onHttpRequest = function onHttpRequest(request, response, form_parser) {
	if (request.method.toUpperCase() === REQUEST_METHOD_POST) {
		var form = form_parser || new formidable.IncomingForm();

		// You can add a third parameter 'files' to this if you want, but we don't use it.
		form.parse(request, function onFormParsed(error, fields) {
			if (error) {
				console.log(error);
				response.statusCode = 500;
				response.end();
				return;
			}			

			switch (request.url) {
				case POST_ACTIVIATE:
					postActivate(fields, function onActivateProcessed(error, response_data) {
						if (error) {
							response.statusCode = error.errorCode;
						}				
						else {							
							response.statusCode = 201;
							response.setHeader("Content-Type", "application/json");
							response.write(JSON.stringify(response_data));
						}		
						response.end();
					});
					break;

				case POST_SHARE:
					postShare(fields, function onShareProcessed(error) {
						if (error) {
							response.statusCode = error.errorCode;
						}
						else {
							response.statusCode = 204;
						}
						response.end();
					});
					break;

				default:		
					response.statusCode = 204;				
					response.end();
					break;
			}
	    });

	    return;
	}
	
	// Hang up.
	response.statusCode = 204;
	response.end();	
};
exports.onHttpRequest = onHttpRequest;

// Create a start the HTTP server.
var waitingLine = http.createServer(onHttpRequest);
waitingLine.listen(WAITING_LINE_PORT);