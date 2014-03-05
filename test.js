/**
 * Test suite for the WaitingLine project.
 */
suite("All", function() {
	var assert = require("assert");

	before(function(done) {
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
				"write": function write(chunk) {
					// TODO check response object
				}
			};
			var mock_form_parser = {
				"parse": function parse(request, callback) {
					callback(null, mock_data, null);
				}
			};

			require("./index.js").onHttpRequest(mock_request, mock_response, mock_form_parser);
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
				"write": function write(chunk) {
					// TODO check response object
				}
			};
			var mock_form_parser = {
				"parse": function parse(request, callback) {
					callback(null, mock_data, null);
				}
			};

			require("./index.js").onHttpRequest(mock_request, mock_response, mock_form_parser);
		});
	});

	after(function(done) {
		done();
	});
});

