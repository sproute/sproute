var _ = require("underscore");

exports.test = function (value, rule) {
	var errors = [];

	console.log("TESTING", value, rule);

	//only validate the type
	if (typeof rule === "string" || rule.type) {
		var type = (rule.type || rule).toLowerCase();

		if (typeof value !== type) {
			errors.push("expected "+type+", got "+(typeof value));
		}
	}

	//list of accepted values
	if (rule.values) {
		if (rule.values.indexOf(value) === -1)
			errors.push("value ("+value+") did not exist in [" + rule.values.join(", ") + "]");
	}

	//maximum length of string or array
	if (rule.maxlen) {
		if (value.length > rule.maxlen)
			errors.push("exceeded maximum length of "+rule.maxlen+" characters, got "+value.length);
	}

	//minimum length of string or array
	if (rule.minlen) {
		if (value.length < rule.minlen)
			errors.push("beneath minimum length of "+rule.minlen+" characters, was given "+value.length);
	}

	//minimum value for Number
	if (rule.min) {
		if (value < rule.min)
			errors.push("value less than the minimum of "+rule.min+", was given "+value);
	}

	//maximum value for Number
	if (rule.max) {
		if (value > rule.max)
			errors.push("value greater than the maximum of "+rule.max+", was given "+value);
	}

	return errors;
};

var naughty = [
	"internal",
	"sproute",
	"private",
	"official",
	"meta",
	"support",
	"blog",
	"help",
	"questions",
	"cache",
	"www",
	"ftp",
	"mail",
	"admin",
	"docs"
];

exports.testFieldName = function (name, strict) {
	if (!name) { return false; }
	
	name = name.trim();
	for (var i = 0; i < naughty.length; ++i) {
		if (name == naughty[i]) {
			return false;
		}
	}

	if (strict) {
		return /^[a-zA-Z][a-zA-Z0-9-]+$/.test(name)
	} else {
		return /^[a-zA-Z][a-zA-Z0-9_-]+$/.test(name)
	}
}