function Error (err) {
	this.template = [];

	this.parse(err);
}

Error.prototype = {
	parse: function (err) {
		if (typeof err === "string") {
			this.template.push({
				message: err
			});
		} else if (Array.isArray(err)) {
			for (var i = 0; i < err.length; ++i) {
				this.parse(err[i]);
			}
		} else if (typeof err === "object") {
			var clone = {};
			clone.message = err.message || "- no error provided -";
			if ('code' in err) clone.code = err.code;
			if ('stack' in err) clone.stack = err.stack || "";

			this.template.push(clone);
		}
	},

	toJSON: function () {
		return JSON.stringify(this.template);
	}
};

module.exports = Error;