var formidable = require("formidable");
var fs = require("fs");
var http = require("http");
var pg = require("pg");

var WAITING_LINE_PORT = 3000;
var REQUEST_METHOD_POST = "POST";
var REQUEST_METHOD_GET = "GET"; 
var POST_ACTIVIATE = "/activate";
var POST_REGISTER = "/register";
var POST_SHARE = "/share";
var GET_VALIDATE = "/validate"; 
var GET_INFO = "/info"; 

var ERROR_ACTIVATION_CODE_INVALID = new Error("Activation code has already been used or does not exist.");
ERROR_ACTIVATION_CODE_INVALID.errorCode = 400;

var ERROR_NO_DEVICE_ID = new Error("A device_id is required.");
ERROR_NO_DEVICE_ID.errorCode = 400;

var ERROR_BAD_HASHED_ID = new Error("Validation code not valid."); 
ERROR_BAD_HASHED_ID.errorCode = 400; 

var ERROR_BAD_SHARE_TYPE = new Error("You can't share with that service. Get on the Twitter!"); 
ERROR_BAD_SHARE_TYPE.errorCode = 400; 

var ERROR_NO_EMAIL = new Error("An email address is required.");
ERROR_NO_EMAIL.errorCode = 400;

var ERROR_DEVICE_DOES_NOT_EXIST = new Error("Device not found.");
ERROR_DEVICE_DOES_NOT_EXIST.errorCode = 400;

var ERROR_DEVICE_EXISTS = new Error("Device is already in line.");
ERROR_DEVICE_EXISTS.errorCode = 400;

var ERROR_PG_QUERY = new Error("Unsuccessful db query."); 
ERROR_PG_QUERY.errorCode = 400; 

var ERROR_FAILED_DATABASE_CONNECT = new Error("Failed to connect to the database.");
ERROR_FAILED_DATABASE_CONNECT.errorCode = 500;

var SETTINGS;

var TWITTER_PERCENT_JUMP = 0.05; 
var FACEBOOK_PERCENT_JUMP = 0.10; 

var LOCKDOWN_DATE = new Date("3/29/2014");


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
 * Read files for emails (html and plain text)
 */
var EMAIL_CONTENT = {};
EMAIL_CONTENT.html = fs.readFileSync(__dirname + '/templates/mail/welcome_mail.html', "utf8");
EMAIL_CONTENT.txt = fs.readFileSync(__dirname + '/templates/mail/welcome_mail.txt', "utf8");

/**
 * Read files for HTML files for validation
 */
var HTML_CONTENT = {};
HTML_CONTENT.validation_template = fs.readFileSync(__dirname + '/templates/html/confirm_mail.html', "utf8");
HTML_CONTENT.validation_partial_success = fs.readFileSync(__dirname + '/templates/html/confirm_mail_success_partial.html', "utf8");
HTML_CONTENT.validation_partial_fail = fs.readFileSync(__dirname + '/templates/html/confirm_mail_fail_partial.html', "utf8");


/**
 * Nodemailer allows to send email. Transporters are created as needed.
 */
var nodemailer = require("nodemailer");


/**
 * Check the database for the existence of a device.
 *
 * The first parameter passed to the callback function should be the device record, or null if no
 * device matching the provided device_id is found.
 *
 * @param client An active PostgreSQL client.
 * @param device_id A device_id to look for.
 * @param cb A callback function to execute after the search. See above for usage.
 */
var checkDevice = function checkDevice(client, device_id, cb) {
	var check_query = "SELECT * FROM device WHERE id = $1";
	client.query(check_query, [device_id], function onCheckDevice(error, check_result) {
		if (error || check_result.rows.length === 0) {
			cb();
		}
		else {
			cb(check_result.rows[0]);
		}
	});
};	
exports.checkDevice = checkDevice;


/**
 * Check the database for the existence of a user by email.
 *
 * The first parameter passed to the callback function should be the etvuser record, or null if no
 * etvuser record matching the provided email address is found.
 *
 * @param client An active PostgreSQL client.
 * @param email An email address to look for.
 * @param cb A callback function to execute after the search. See above for usage.
 */
var checkUser = function checkUser(client, email, cb) {
	var check_query = "SELECT * FROM etvuser WHERE email = $1";
	client.query(check_query, [email], function onCheckEtvUser(error, check_result) {
		if (error || check_result.rows.length === 0) {
			cb();
		}
		else {
			cb(check_result.rows[0]);
		}
	});
};	
exports.checkUser = checkUser;

/**
 * One-way encodes the user's device_id and email address.
 *
 * @param device_id The device id to encode.
 * @param email The email address to encode.
 * @return An object with the salt used to pad the device_id and email and the encoded hash.
 */
var encodeRequestHash = function encodeRequestHash(device_id, email) {	
	var crypto = require("crypto");
	var uuid = require("node-uuid");
	var salt = uuid().replace(/-/g, "");
	var hash = crypto.createHmac("sha512", salt);
	hash.update(email);
	hash.update(device_id);
	var request_hash = {
		"salt": salt,
		"hash": hash.digest("hex")
	};
	return request_hash;
};
exports.encodeRequestHash = encodeRequestHash;

/**
 * Creates a request to create a new user. We create a unique hash for the user, insert it into
 * the EtvUserRequest table and finally send an email to the provided address with a link. The link
 * should contain the hash.
 *
 * We can ask the user to enter their email address for additional confirmation but simply clicking
 * on the link, given the sparsity of hash addresses, should be enough.
 *
 * @param client An active PostgreSQL client.
 * @param device_id The device_id to associate with this email address.
 * @param _email The email address of the user that we'll send a confirmation mail to.
 * @param cb A callback function to execute after we're mailed the user. 
 */
var addUserRequest = function addUserRequest(client, device_id, _email, cb) {
	var email = _email && _email.toLowerCase().replace(/[\s\r\n]/g, "");
	if (!email) {
		cb(ERROR_NO_EMAIL);
		return;
	}

	var encoded = encodeRequestHash(device_id, email);
	var request_insert =  "INSERT INTO etvuserrequest (id, email, device_id, salt) VALUES ($1, $2, $3, $4) RETURNING *;";

	client.query(request_insert, [encoded.hash, email, device_id, encoded.salt], function onRequestInsert(error, result) {
		if (error) {
			cb(error);
			return;
		}
		cb(null, result.rows[0]);
	});
};
exports.addUserRequest = addUserRequest;

/**
 * Check if the validation code in the query string matches one in the db, 
 * and if so insert the user into etvuser and etvuserdevice
 */
var getValidate = function getValidate(hashed_id, callback) {
	var vq = "SELECT email, device_id FROM etvuserrequest WHERE id = $1;"; 

	//connect to the db 
	pg.connect(SETTINGS.pg, function onPostgreSQLConnect(err, client, done) {
		if (err) {
			done(client); 
			callback(ERROR_FAILED_DATABASE_CONNECT); 
			return; 
		}

		client.query(vq, [hashed_id], function(err, result) {
			if (err) {
				console.log(err); 
				done(client);
				callback(ERROR_PG_QUERY); 
				return; 
			}

			if (result.rows.length === 0) {
				done(client);
				callback(ERROR_BAD_HASHED_ID); 
				return; 
			} 

			var user_q = "INSERT INTO etvuser (email) VALUES ($1) RETURNING *;"; 
			client.query(user_q, [result.rows[0].email], function(err, user_r) {
				if (err) {
					console.log(err); 
					done(client);
					callback(ERROR_PG_QUERY); 
					return;
				}

				var user_id = user_r.rows[0].id; 
				var dev_id = result.rows[0].device_id; 
				var userdevq = "insert INTO etvuserdevice (user_id, device_id) VALUES ($1, $2);"; 
				client.query(userdevq, [user_id, dev_id], function(err, device_result) {
					if (err) {
						console.log(err); 
						callback(ERROR_PG_QUERY); 
						done(client);
						return; 
					}

					done(client);
					callback(); 
				});
			});
		});
	});
};


exports.getValidate = getValidate; 

// get the queue data to display on the webpage 
var getInfo = function getInfo(callback) {
	var q = "SELECT SUM(CASE WHEN is_activated = TRUE THEN 1 END) as let_in,"; 
	q += " SUM(CASE WHEN is_activated = FALSE THEN 1 END) as still_waiting"; 
	q += " FROM device;"; 

	pg.connect(SETTINGS.pg, function onPostgreSQLConnect(err, client, done) {
		if (err) {
			console.log(err); 
			done(client); 
			callback(ERROR_FAILED_DATABASE_CONNECT); 
			return; 
		}

		client.query(q, function(error, result) {
			if (error) {
				console.log(error);
				done(client); 
				callback(ERROR_PG_QUERY); 
				return; 
			}
			// close the PG client! 
			done(client); 

			var response_data = {
				"let_in": result.rows[0].let_in, 
				"still_waiting": result.rows[0].still_waiting 
			}; 

			callback(null, response_data); 
		});
	});
};
exports.getInfo = getInfo; 


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
			} else if (Date.now() < LOCKDOWN_DATE.getTime()) {
				// The queue is not in place yet.
				insert_query = "INSERT INTO device (id, is_activated, activated_date) VALUES ($1, TRUE, NOW()) RETURNING priority";
				insert_parameters = [data.device_id];
			} else {
				// The queue is in place, don't set is_activated = TRUE.
				insert_query = "INSERT INTO device (id) VALUES ($1) RETURNING priority";
				insert_parameters = [data.device_id];
			}

			client.query(insert_query, [data.device_id], function onInsert(error, insert_result) {
				if (error) {
					cb(ERROR_DEVICE_EXISTS);
				}
				else {
					if (activationcode_id) {
						useActivationCode(activationcode_id, function onActivationCodeUsed(error) {
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
				checkDevice(client, data.device_id, function onDeviceChecked(device) {
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
							response_object.activated = Date.now() < LOCKDOWN_DATE.getTime();

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
			checkDevice(client, data.device_id, function onDeviceChecked(device) {
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


var postRegister = function postRegister(data, transporter, callback) {
	if (!data.device_id) {
		callback(ERROR_NO_DEVICE_ID);
		return;
	}

	if (!data.email) {
		callback(ERROR_NO_EMAIL);
		return;
	}

	// Connect to the PostgreSQL database.
	pg.connect(SETTINGS.pg, function onPostgreSQLConnect(error, client, done) {
		if (error) {			
			done(client);
			callback(ERROR_FAILED_DATABASE_CONNECT);
			return;
		}	

		checkDevice(client, data.device_id, function onDeviceChecked(device) {
			if (!device) {
				done(client);
				callback(ERROR_DEVICE_DOES_NOT_EXIST);
				return;
			}

			checkUser(client, data.email, function onEmailChecked(user) {
				if (user) {
					done(client);
					callback(ERROR_USER_EXISTS);
					return;
				}

				addUserRequest(client, data.device_id, data.email, function onUserRequestAdded(error, user_request) {
					var response_data = {
						"status": error ? 1 : 0
					};

					done(client);
					
					if (error) {
						callback(null, response_data);
						return;
					}

					var validation_link = "http://" + SETTINGS.domain + ":" + SETTINGS.port + "/validate?code=" + user_request.id;

					/*
					var mail_body = "Thanks for queueing for Endless TV.\n"; 
					mail_body += "Click the link below to confirm that you've done so.\n"; 
					mail_body += "(And if you haven't, now's your chance to check it out!)\n\n\n";
					mail_body += validation_link; 
					*/

					var options = {
						from: "EndlessTV <hello@mail.endlesstv.com>", 
						to: user_request.email, 
						subject: "Get early access to EndlessTV", 
						text: EMAIL_CONTENT.txt.replace(/\{{VALIDATION_LINK}}/, validation_link).replace(/\n/g,"\r\n"),
						html: EMAIL_CONTENT.html.replace(/\{{VALIDATION_LINK}}/, validation_link)
					}; 
					transporter.sendMail(options, function onMailTransport(error, response) {
						if (error) {
							console.log(error);
						}
						callback(null, response_data);
					});
				});
			});
		});
	});		
};
exports.postRegister = postRegister;

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

	if (!data.sharetype || (data.sharetype !== "twitter" && data.sharetype !== "facebook")) {
		callback(ERROR_BAD_SHARE_TYPE); 
		return; 
	}

	var onPostShare = function onPostShare(device_id, sharetype) {

		pg.connect(SETTINGS.pg, function onPostgreSQLConnect(error, client, done) {
			if (error) {
				done(client); 
				callback(ERROR_FAILED_DATABASE_CONNECT); 
				return; 
			}

			var decrement = 1;  
			decrement -= sharetype === "facebook" ? FACEBOOK_PERCENT_JUMP : TWITTER_PERCENT_JUMP;  
			var q = "UPDATE device SET priority = floor(" + decrement + "* priority) WHERE id = $1 RETURNING *;"; 

			client.query(q, [device_id], function(err, result) {
				done(client);
				if (err) {
					console.log(err); 
					callback(ERROR_PG_QUERY); 
					return; 
				}
				var response_data = {
					"status": error ? 1 : 0, 
					"priority": result.rows[0].priority 
				}; 

				// if no result the device id does not exist 
				if (result.rows.length === 0) {
					callback(ERROR_DEVICE_DOES_NOT_EXIST); 
					return; 
				}

				callback(null, response_data); 
			});
		});
	};

	onPostShare(data.device_id, data.sharetype); 
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

				case POST_REGISTER:
					var transporter = nodemailer.createTransport("SMTP", {
						"service": SETTINGS.mail && SETTINGS.mail.service, 
						"auth": {
							"user": SETTINGS.mail && SETTINGS.mail.user,
							"pass": SETTINGS.mail && SETTINGS.mail.pass
						}
					});

					// We inject an email transporter so that we can mock an email transporter
					// during integration and unit testing.
					postRegister(fields, transporter, function onRegisterProcessed(error, response_data) {
						// Close our mail transporter regardless of the outcome.
						transporter.close();						

						if (error) {
							response.statusCode = error.errorCode;
						}
						else {
							response.statusCode = 200;
							response.setHeader("Content-Type", "application/json");
							response.write(JSON.stringify(response_data));
						}
						response.end();
					});
					break;

				case POST_SHARE:
					postShare(fields, function onShareProcessed(error, response_data) {
						if (error) {
							response.statusCode = error.errorCode;
						}
						else {
							response.statusCode = 200;
							response.setHeader("Content-Type", "application/json"); 
							response.write(JSON.stringify(response_data)); 
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
	} // end if 
	else if (request.method.toUpperCase() === REQUEST_METHOD_GET) {
		var qs_index = request.url.indexOf("?"); 
		var route; 

		if (qs_index !== -1) { 
			route = request.url.slice(0, request.url.indexOf("?")); 
		} else {
			route = request.url; 
		}
 
		switch(route) {

			case GET_VALIDATE: 
				var code = request.url.slice(request.url.indexOf("code=") + 5); 
				var out;
				getValidate(code, function(error) {
					if (error) {
						console.log(error); 
						response.statusCode = error.errorCode; 
						out = HTML_CONTENT.validation_template
							.replace(/\{{HTML_CONTENT}}/, HTML_CONTENT.validation_partial_fail)
							.replace(/\r?\n|\r/g, '');
					} else {
						response.statusCode = 200;
						out = HTML_CONTENT.validation_template
							.replace(/\{{HTML_CONTENT}}/, HTML_CONTENT.validation_partial_success)
							.replace(/\r?\n|\r/g, '');
						//response.writeHead(200, {"Content-Type": "application/json"}); 
						//var message = "Thanks for confirming!"; 
						//var json = {}; 
						//json.message = message; 
						//json.validation = "success"; 
						//response.write(JSON.stringify(json)); 
					}
					response.writeHead(response.statusCode, {"Content-Type": "text/html"}); 
					response.write(out); 
					response.end(); 
				});
				break; 

			case GET_INFO:
				getInfo(function(err, json_response) {
					if (err) {
						console.log(err); 
						response.statusCode = err.errorCode; 
					} else {
						response.writeHead(200, {"Content-Type": "application/json"}); 
						response.write(JSON.stringify(json_response)); 
					}	
					response.end(); 
				});
				break;  	

			default: 
				response.statusCode = 204; 
				response.end(); 
				break; 
		}
	} // end else if 

	// Hang up.
	else {
		response.statusCode = 204;
		response.end();	
	}
};
exports.onHttpRequest = onHttpRequest;

// Create a start the HTTP server.
var waitingLine = http.createServer(onHttpRequest);
waitingLine.listen(WAITING_LINE_PORT);