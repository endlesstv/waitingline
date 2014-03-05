var formidable = require("formidable");
var fs = require("fs");
var http = require("http");
var pg = require("pg");

var WAITING_LINE_PORT = 3000;
var REQUEST_METHOD_POST = "POST";
var POST_ACTIVIATE = "/activate";
var POST_SHARE = "/share";

var ERROR_ACTIVATION_CODE_INVALID = new Error("Activation code has already been used or does not exist.");
ERROR_ACTIVATION_CODE_INVALID.errorCode = 400;

var ERROR_NO_DEVICE_ID = new Error("A device_id is required.");
ERROR_NO_DEVICE_ID.errorCode = 400;

var ERROR_DEVICE_EXISTS = new Error("Device is already in line.");
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

		var useActivationCode = function useActivationCode(activationcode_id, cb) {
			var use_query = "UPDATE activationcode";
			use_query += " SET used = TRUE, used_date = NOW(), last_upd = NOW()";
			use_query += " WHERE id = $1";

			client.query(use_query, [activationcode_id], function(error) {
				cb(error);
			});
		};		

		var activateDevice = function activateDevice(activationcode_id, device_id, cb) {
			if (!activationcode_id) {
				// Invalid activation code.
				cb();
				return;
			}

			var activate_query = "UPDATE device";
			activate_query += " SET is_activated = TRUE, activationcode_id = $1, activated_date = NOW(), last_upd = NOW()";
			activate_query += " WHERE id = $2";
			client.query(activate_query, [activationcode_id, device_id], function(error) {
				if (error) {
					cb(error);
				}
				else {
					useActivationCode(activationcode_id, cb);
				}
			});
		};

		var checkDevice = function checkDevice(cb) {
			// Check if a device has been enqueued. If it has, we execute the callback with its
			// data as the first parameter. If it has not, the first parameter will be null. Pg
			// throws an error when your search returns 0 results.
			var check_query = "SELECT * FROM device WHERE id = $1";
			client.query(check_query, [data.device_id], function onCheckDevice(error, check_result) {
				if (error) {
					cb(null);
				}
				else {
					cb(check_result.rows[0]);
				}
			});
		};

		var checkPlace = function checkPlace(priority, cb) {
			var place = priority;
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
				cb(place, total);
			});			
		};

		var insertDevice = function insertDevice(activationcode_id, cb) {
			// Attempt to insert the device into the database. If it fails, we can be reasonably
			// certain that failure is caused because of key duplication, i.e. a second attempt to
			/// register an already registered device.
			var insert_query;
			var insert_parameters;

			if (activationcode_id) {
				insert_query = "INSERT INTO device (id, is_activated, activated_date, activationcode_id) VALUES ($1, TRUE, NOW(), $2) RETURNING priority";
				insert_parameters = [data.device_id, activationcode_id];
			}
			else {
				insert_query = "INSERT INTO device (id) VALUES ($1) RETURNING priority";
				insert_parameters = [data.device_id];
			}
			client.query(insert_query, [data.device_id], function onInsert(error, insert_result) {
				if (error) {
					cb(ERROR_DEVICE_EXISTS);
				}
				else {
					if (activationcode_id) {
						useActivationCode(activationcode_id, function(error) {
							cb(null, insert_result.rows[0].priority);
						});
					}
					else {
						cb(null, insert_result.rows[0].priority);	
					}
				}
			});	
		};

		var checkActivationCode = function checkActivationCode(code, cb) {
			var check_query = "SELECT * FROM activationcode WHERE code = $1 AND used = FALSE";
			client.query(check_query, [code], function(error, result) {
				if (error || result.rows.length === 0) {
					cb(0);
					return;
				}
				console.log(result);
				cb(result.rows[0].id);
			});
		};

		var response_object = {
			"status": 0,
			"place": 0,
			"total": 0,
			"activated": false
		};

		// Clean up and callback to the HTTP request.
		var respond = function respond() {
			done(client);
			callback(null, response_object);
		};

		if (data.activation_code) {
			// Check if the activation code exists and has not been used.
			checkActivationCode(data.activation_code, function(activationcode_id) {
				if (activationcode_id === 0) {
					// The code was used or doesn't exist, add an error message to the response but
					// continue logic as we may need to enqueue a new device.
					response_object.status = 1;
					response_object.message = ERROR_ACTIVATION_CODE_INVALID.message;
				}

				// Check the device to see if it has been previously registered. If it has, we
				// we don't add the error as we do below, to avoid confusion on successfully
				// activating a device that already exists.
				checkDevice(function(device) {
					if (device) {
						if (device.is_activated) {
							response_object.status = 1;
							response_object.message = "Device is already activated";

							// Don't use another activation code on this activated device.
							activationcode_id = 0;
							response_object.activated = true;
						}

						activateDevice(activationcode_id, device.id, function(error) {
							if (error) {
								response_object.status = 1;
								response_object.message = "Failed to activate device (unknown).";
							}
							else if (activationcode_id > 0) {
								response_object.activated = true;
							}

							checkPlace(device.priority, function(place, total) {		
								response_object.place = place;
								response_object.total = total;
								respond();
							});					
						});
					}
					else {
						// Because 0 is falsy, logic that inserts an activatecode_id should
						// function normally.
						insertDevice(activationcode_id, function(error, priority) {
							if (error) {
								response_object.status = 1;
								response_object.message = error.message;
							}

							checkPlace(priority, function(place, total) {						
								response_object.place = place;
								response_object.total = total;
								respond();								
							});
						});
					}
				});
			});
		}
		else {
			// We're enqueuing a device without an activation code. Check if the device is already
			// enqueued before attempting to insert it.
			checkDevice(function(device) {
				if (device) {
					response_object.activated = device.is_activated;
					response_object.status = 1;
					response_object.message = ERROR_DEVICE_EXISTS.message;					

					checkPlace(device.priority, function(place, total) {						
						response_object.place = place;
						response_object.total = total;						
						respond();
					});
				}
				else {
					insertDevice(0, function(error, priority) {
						if (error) {
							response_object.status = 1;
							response_object.message = error.message;
						}

						checkPlace(priority, function(place, total) {						
							response_object.place = place;
							response_object.total = total;
							respond();
						});
					});
				}
			});
		}
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