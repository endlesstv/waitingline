#WaitingLine

[Everyone's Taking Everything They Can](http://www.youtube.com/watch?v=5tZlu4wP4pw)

Waiting list queue for the EndlessTV flagship launch. Lower priority is better; priority 1 means
you're going to go first. Priority -1 means you were going to go first and then you shared!

##Configuration

Waitingline uses a simple JSON configuration object you must store in `config.json` in the
root directory of the project.

```javascript
// config.json
{
	// Required; connecting string for PostgreSQL.
	"pg": "postgres://user:pw@server:port/database",

	// Optional; a port to accept HTTP requests on.
	"port": 12345,

	// Optional; used to send email during registration. 
	"mail": {
		"service": "Provider",
		"user": "sender@provider.com",
		"pass": "passwordForSender"
	}
}
```

##Testing

To run tests, specify a testing configuration in `testing.json`. It has the same format and values
as the `config.json` example above.

WaitingLine uses Mocha to perform unit and integration tests. Please run tests with `npm test`
before pushing code to master. Testing adds and removes records from the database, so please check
and make sure your PostgreSQL connection string points to a development database.

##Routes

The following HTTP routes are supported.

###POST /activate

Activate a device. Accepts plain text or JSON data. A unique `device_id` must be supplied in the
body of the request. Optionally, a `activation_code` may be supplied. If the `activation_code` is
valid, the device will be activated. A successful response should return a 200 or 201, JSON:

```javascript
{
	"activated": false,  // The device's activation status.
    "place": 57,         // The device's place in the queue.
    "status": 0,         // Status code of the response; 0 for success, 1 for failure.
    "total": 58          // The total number of devices in the queue.
}
```

In the event that `status` indicates an error, a `message` key may supply additional data.

###POST /register

Notify the server that a user wishes to associate an `email` with a `device_id`, both must be
present in the request body. If successful (e.g. the user is not already validated), the server 
will email the supplied address with a confirmation link. Clicking on the confirmation link
will validate the user.

Multiple validation requests can be registered to the same email address. The first one opened
will validate the user.

###POST /share

Notify the server of a device share; should lower the device's priority on success.

##Data Model

Listed in

###ActivationCode

Represents a single-use code that allows the user to immediately activate a device.

```sql
CREATE TABLE activationcode(
	id SERIAL PRIMARY KEY,
	code TEXT NOT NULL DEFAULT '',
	used BOOLEAN NOT NULL DEFAULT FALSE,
	used_date TIMESTAMP,
	created TIMESTAMP NOT NULL DEFAULT NOW(),	
	last_upd TIMESTAMP NOT NULL DEFAULT NOW()
);
```

###Device

Represents a mobile device submitted to the queue for activation. Due to the foreign key constraint
on `activationcode_id`, Device depends on the existence of ActivationCode.

```sql
CREATE TABLE device(
	id TEXT PRIMARY KEY,
	priority SERIAL,		
	is_activated BOOLEAN NOT NULL DEFAULT FALSE,
	activated_date TIMESTAMP,
	activationcode_id integer REFERENCES activationcode (id) ON DELETE CASCADE,	
	created TIMESTAMP NOT NULL DEFAULT NOW(),
	last_upd TIMESTAMP NOT NULL DEFAULT NOW()	
);
```

###EtvUser

Represents a user.

```sql
CREATE TABLE etvuser(
	id SERIAL PRIMARY KEY,
	email TEXT UNIQUE NOT NULL,
	created TIMESTAMP NOT NULL DEFAULT NOW(),
	last_upd TIMESTAMP NOT NULL DEFAULT NOW()
);
```

###EtvUserDevice

Represents a relationship between a user and one or more devices.

```sql
CREATE TABLE etvuserdevice(
	user_id integer NOT NULL REFERENCES etvuser (id) ON DELETE CASCADE,
	device_id TEXT NOT NULL REFERENCES device (id) ON DELETE CASCADE,
	created TIMESTAMP NOT NULL DEFAULT NOW(),
	last_upd TIMESTAMP NOT NULL DEFAULT NOW()
);
```

###EtvuserRequest

A request to create a user that has not yet been validated by an email link click.


```sql
CREATE TABLE etvuserrequest(
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	device_id TEXT NOT NULL REFERENCES device (id) ON DELETE CASCADE,
	salt TEXT NOT NULL,
	created TIMESTAMP NOT NULL DEFAULT NOW(),
	last_upd TIMESTAMP NOT NULL DEFAULT NOW()
);
```
