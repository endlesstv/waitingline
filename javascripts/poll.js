// locaton param is 'inside' or 'outside'
function updateCount(count, location) { 
	var tag_id; 
	if (location === 'inside') tag_id = 'inside-count'; 
	if (location === 'outside') tag_id = 'outside-count'; 

	$("#" + tag_id).text(count);  
}; 

// connect to the webserver
var SERVER_URL = "localhost"
var socket = new io.connect(SERVER_URL, {port: 3000}); 
// listeners 
socket.on('connect', function() {
	//console.log('Client connected'); 
});

socket.on('message', function(count_data) {
	count_data = JSON.parse(count_data);   
	updateCount(count_data.inside, 'inside'); 
	updateCount(count_data.outside, 'outside'); 
});

socket.on('disconnect', function() {
	//console.log("You've been dumped. Sorry kid."); 
});

socket.connect()

	


