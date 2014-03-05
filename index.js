var formidable = require("formidable");
var http = require("http");

var WAITING_LINE_PORT = 3000;
var REQUEST_METHOD_POST = "POST";
var POST_ACTIVIATE = "/activate";
var POST_SHARE = "/share";

/**
 * Check if the device is in the queue. If it is not in the queue, add it to the queue.
 *
 * @param data A data form sent by a device with its information.
 * @param callback A callback function to let the HTTP server know we're done processing data.
 */
var postActivate = exports.postActivate = function postActivate(data, callback) {
	callback && callback();
};

/**
 * Check if the device shared. If the device shared, reward the device by lowering its priority in
 * the queue.
 *
 * @param data A data form sent by a device with some information about the share attempt.
 * @param callback A callback function to let the HTTP server know we're done processing data.
 */
var postShare = exports.postShare = function postShare(data, callback) {
	callback && callback();
};

/**
 * Handles incoming HTTP requests.
 *
 * @param request A node.js http.ClientRequest object. Do not modify.
 * @param response A node.js http.ServerResponse object. Do not modify, always call end().
 * @param form_parser An optional object for parsing form data that is injected during testing.
 */
var onHttpRequest = exports.onHttpRequest = function onHttpRequest(request, response, form_parser) {
	if (request.method.toUpperCase() === REQUEST_METHOD_POST) {
		var form = form_parser ? form_parser : new formidable.IncomingForm();

		form.parse(request, function onFormParsed(error, fields, files) {
			if (error) {
				console.log(error);
				response.end();
				return;
			}			

			switch (request.url) {
				case POST_ACTIVIATE:
					postActivate(fields, function onActivateProcessed() {
						response.end();
					});
					break;

				case POST_SHARE:
					postShare(fields, function onShareProcessed() {
						response.end();
					});
					break;

				default:						
					response.end();
					break;
			}
	    });

	    return;
	}
	
	// Hang up.
	response.end();	
};

// Create a start the HTTP server.
var waitingLine = http.createServer(onHttpRequest);
waitingLine.listen(WAITING_LINE_PORT);