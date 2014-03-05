#WaitingLine

[Everyone's Taking Everything They Can](http://www.youtube.com/watch?v=5tZlu4wP4pw)

Waiting list queue for the EndlessTV flagship launch. Lower priority is better; priority 1 means
you're going to go first. Priority -1 means you were going to go first and then you shared!

##Configuration

_WaitingLine_ uses a simple JSON configuration object you must store in `config.json` in the
root directory of the project.

```javascript
{
	"pg": "postgres://user:pw@server:port/database",
	"port": 12345
}
```

##Routes

The following HTTP routes are supported.

###POST /activate

Activate a device.

###POST /share

Notify the server of a device share; should lower the device's priority on success.

##Data Model

###Device

Represents a mobile device submitted to the queue for activation.

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