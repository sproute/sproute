
var ConfigController = Spineless.View.extend({
	tag: "config",

	defaults: {
		"errorView": "",
		"reCAPTCHA": "",
		"rateLimit": 10,
		"url": ""
	},

	template: [
		{text: "Settings", className: "heading config"},

		{className: "new", children: [

			{tag: "label", children: [
				{tag: "span", text: "Error View: "},
				{tag: "select", id: "errorView", children: [
					{tag: "option", value: "", text: "None"}
				]}
			]},

			{tag: "label", children: [
				{tag: "span", text: "reCAPTCHA: "},
				{tag: "input", id: "reCAPTCHA"}
			]},

			{tag: "label", children: [
				{tag: "span", text: "Rate Limit: "},
				{tag: "input", id: "rateLimit"},
				{tag: "span", className: "hint", text: "Seconds between throttling requests per IP"}
			]},

			{tag: "label", children: [
				{tag: "span", text: "URL: "},
				{tag: "input", id: "url"},
				{tag: "span", className: "hint", text: "If using custom domain, put here. e.g. http://mysproutespace.com"}
			]},

			{tag: "button", text: "Update Config", id: "submit"}

		]}
	],

	events: {
		"click submit": "onSubmit"
	},

	init: function (opts) {
		ConfigController.super(this, "init", arguments);

		var id = this.sync("get", "/admin/config");
		this.once(id, function (config) {
			this.config = config;
			this.set(config);
		});

		var id = this.sync("get", "/admin/views");
		this.once(id, function (views) {
			for (var i = 0; i < views.length; ++i) {
				var name = views[i].substring(0, views[i].lastIndexOf("."));

				this.errorView.appendChild(Spineless.View.toDOM({
					tag: "option",
					value: name,
					text: name
				}))
			}

			if (this.config.errorView) {
				this.set("errorView", this.config.errorView)
			}
		});

		new PasswordController({superview: this.container})
	},

	onSubmit: function () {
		console.log(this.model);
		this.post("/admin/config");
	}
});

var PasswordController = Spineless.View.extend({
	tag: "password",

	defaults: {
		pass: "",
		newpass: ""
	},

	template: [
		{className: "new", children: [
			{tag: "label", children: [
				{tag: "span", text: "Old Password: "},
				{tag: "input", id: "pass", type: "password"},
				{tag: "span", className: "hint", text: "Enter your current password."}
			]},

			{tag: "label", children: [
				{tag: "span", text: "New Password: "},
				{tag: "input", id: "newpass", type: "password"},
				{tag: "span", className: "hint", text: "Enter your desired password."}
			]},

			{tag: "button", text: "Update Password", id: "submit"}
		]}
	],

	events: {
		"click submit": "onSubmit"
	},

	onSubmit: function () {
		this.post("/api/update");
	}
});

$(".config").click(function () {
	$("#page").empty();
	if (p) {
		p.removeFromParent();
	}

	p = new ConfigController({
		superview: "page"
	});	
})