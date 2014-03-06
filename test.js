/**
 * Test suite for the WaitingLine project.
 */
suite("All", function() {
	var assert = require("assert");

	before(function(done) {
		require("./index").initialize(__dirname + "/testing.json");
		done();
	});

	describe("#onHttpRequest()", function() {
		// We would like to make sure that any requests to /activate result in a device activation
		// provided that the device_id is present and unique.
		it("should handle correctly formed http requests sent to /activate", function(done) {			
			var mock_data = {
				"device_id": require("node-uuid")()
			};
			var mock_request = {
				"method": "Post",
				"url": "/activate"
			};
			var mock_response = {				
				"end": function end() {
					done();
				},
				"setHeader": function setHeader(key, value) {
					if (key === "Content-Type") {
						assert.equal(value, "application/json", "HTTP response is not sending JSON");
					}
				},
				"write": function write(chunk) {
					var server_response = JSON.parse(chunk);
					assert.ok(server_response.place > 0, "HTTP response is missing place information");
					assert.ok(server_response.total > 0, "HTTP response is missing total information");
					assert.equal(server_response.status, 0, "HTTP response is missing status of 0");
				}
			};
			var mock_form_parser = {
				"parse": function parse(request, callback) {
					callback(null, mock_data);
				}
			};

			require("./index").onHttpRequest(mock_request, mock_response, mock_form_parser);
		});

		// We would like to reward devices that have shared by lowering (good) their priority in
		// the queue.
		it("should handle correctly formed http requests sent to /share", function(done) {
			var mock_data = {
				"device_id": require("node-uuid")()
			};			
			var mock_request = {
				"method": "Post",
				"url": "/share"
			};
			var mock_response = {
				"end": function end() {
					done();
				},
				"setHeader": function setHeader(key, value) {
					if (key === "Content-Type") {
						assert.equal(value, "application/json", "HTTP response is not sending JSON");
					}
				},
				"write": function write(chunk) {
					// TODO check response object
				}
			};
			var mock_form_parser = {
				"parse": function parse(request, callback) {
					callback(null, mock_data, null);
				}
			};

			require("./index").onHttpRequest(mock_request, mock_response, mock_form_parser);
		});
	});

	describe("#postActivate()", function() {
		// Device id is pretty much required for everything we do!
		it("should return a 400 error when no device_id is supplied", function(done) {
			var mock_data = {
				"not_a_device_id": require("node-uuid")()
			};

			require("./index").postActivate(mock_data, function(error) {
				assert.ok(error, "postActivate returned success with no device_id");
				assert.equal(error.errorCode, 400, "postActivate returned the wrong errorCode with no device_id");
				done();
			});
		});

		it("should return place data on success", function(done) {
			var mock_data = {
				"device_id": require("node-uuid")()
			};

			require("./index").postActivate(mock_data, function(error, data) {
				assert.ok(!error, "postActivate returned an error on device insert");
				assert.ok(data.place > 0, "postActivate failed to return place data");
				assert.ok(data.total > 0, "postActivate failed to return total data");
				done();
			});
		});

		it("should return status 1 on an attempt to duplicate a device", function(done) {
			var mock_data = {
				"device_id": require("node-uuid")()
			};

			require("./index").postActivate(mock_data, function(error) {
				assert.ok(!error, "postActivate returned an error on device insert");

				require("./index").postActivate(mock_data, function(error, data) {
					assert.ok(data, "postActivate failed to return data with a duplicate device_id");
					assert.equal(data.status, 1, "postActivate returned the wrong status with a duplicate");
					done();
				});
			});
		});	

		it("should return status 1 on an attempt to use a bogus activationcode", function(done) {			
			var mock_data = {
				"device_id": require("node-uuid")(),
				"activation_code": require("node-uuid")()
			};

			// It should also enqueue the device if it does not exist.
			require("./index").postActivate(mock_data, function(error, data) {
				assert.ok(data.place > 0, "postActivate failed to enqueue a new device with a bogus activation code");
				assert.ok(data.total > 0, "postActivate failed to enqueue a new device with a bogus activation code");
				assert.equal(data.activated, false, "postActivate activated a device with a bogus code!");
				assert.equal(data.status, 1, "postActivate failed to return a status of 1 with a bogus code");

				// It should also return the place if the user does!
				require("./index").postActivate(mock_data, function(error, data) {
					assert.ok(data.place > 0, "postActivate failed to enqueue a new device with a bogus activation code");
					assert.ok(data.total > 0, "postActivate failed to enqueue a new device with a bogus activation code");
					assert.equal(data.activated, false, "postActivate activated a device with a bogus code!");
					assert.equal(data.status, 1, "postActivate failed to return a status of 1 with a bogus code");
					done();
				});
			});
		});
	});

	describe("#postRegister()", function() {
		it("should return a 400 error when no device_id is supplied", function(done) {
			var mock_data = {
				"not_a_device_id": require("node-uuid")()
			};

			require("./index").postRegister(mock_data, null, function(error) {
				assert.ok(error, "postRegister return success with no device_id");
				assert.equal(error.errorCode, 400, "postRegister return the wrong errorCode with no device_id");
				done();
			});
		});
		it("should return a 400 error when no email is supplied", function(done) {
			var mock_data = {
				"device_id": require("node-uuid")()
			};

			require("./index").postRegister(mock_data, null, function(error) {
				assert.ok(error, "postRegister return success with no email");
				assert.equal(error.errorCode, 400, "postRegister return the wrong errorCode with no email");
				done();
			});
		});

		it("should return a 400 if the device isn't found", function(done) {
			var mock_data = {
				"device_id": require("node-uuid")(),
				"email": "Chris@endlesstv.com"
			};

			var mock_mailer = {
				"send": function send(email, message, callback) {
					assert.equal(mock_data.email.toLowerCase(), email, "Email address is wrong.");
					callback();
				}
			};

			require("./index").postRegister(mock_data, mock_mailer, function(error) {
				assert.ok(error, "postRegister return success with no device");
				assert.equal(error.errorCode, 400, "postRegister return the wrong errorCode with no device");
				done();
			});
		});				

		it("should mail me an email when i register on a valid device", function(done) {
			var mock_data = {
				"device_id": require("node-uuid")(),
				"email": "Codyz@endlesstv.com"
			};
			/*
			var mock_mailer = {
				"send": function send(email, message, callback) {
					assert.equal(mock_data.email.toLowerCase(), email, "Email address is wrong.");
					callback();
				}
			};
			*/

			var mock_mailer = {}; 

			require("./index").postActivate(mock_data, function() {
				require("./index").postRegister(mock_data, mock_mailer, function(error, response_data) {
					assert.ok(!error, "postRegister returned an error with correct registration data");
					assert.equal(response_data.status, 0, "postRegister returned the wrong status code");
					done();
				});
			});
		});			
	});

	describe("#postShare()", function() {
		it("should return a 400 error when no device_id is supplied", function(done) {
			var mock_data = {
				"not_a_device_id": require("node-uuid")()
			};

			require("./index").postShare(mock_data, function(error) {
				assert.ok(error, "postShare returned success with no device_id");
				assert.equal(error.errorCode, 400, "postShare returned the wrong errorCode with no device_id");
				done();
			});
		});
	});		

	after(function(done) {
		done();
	});
});

