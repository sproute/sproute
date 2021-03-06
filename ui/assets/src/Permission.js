var accessOptions = [
	{tag: "option", value: "anyone", text: "Anyone"},
	{tag: "option", value: "stranger", text: "Stranger"},
	{tag: "option", value: "member", text: "Member"},
	{tag: "option", value: "owner", text: "Owner", selected: ""},
	{tag: "option", value: "admin", text: "Admin"}
];

var methodOptions = [
	{tag: "option", value: "*", text: "* ALL"},
	{tag: "option", value: "GET", text: "GET"},
	{tag: "option", value: "POST", text: "POST"},
	{tag: "option", value: "DELETE", text: "DELETE"}
];

var PermissionController = Spineless.View.extend({
	template: [
		{text: "Permissions", className: "heading permissions"},
		{id: "permissionList", className: "list"},
		{className: "create", children: [
			{tag: "label", children: [
				{tag: "span", text: "Method: "},
				{tag: "select", id: "method", children: methodOptions}
			]},

			{tag: "label", children: [
				{tag: "span", text: "Route: "},
				{tag: "input", id: "route"}
			]},

			{tag: "label", children: [
				{tag: "span", text: "User: "},
				{tag: "select", id: "user", children: accessOptions}
			]},

			{tag: "button", id: "submit", text: "Add Permission"}
		]}
	],

	events: {
		"click submit": "onSubmit"
	},

	defaults: {
		"route": "",
		"user": "owner",
		"method": "*"
	},

	init: function () {
		PermissionController.super(this, "init", arguments);

		this.sync("get", "/admin/permissions");
		this.once("sync:get", function (resp) {
			console.log(resp)
			for (var route in resp) {
				this.addChild(new Permission({
					superview: this.permissionList,
					route: route,
					user: resp[route]
				}))
			}
		});
	},

	onSubmit: function () {
		var d = {};
		var route = this.model.method + " " + this.model.route;
		d[route] = this.model.user;
		console.log(d, this.model)
		var id = this.post("/admin/permissions", d);
		this.once("sync:" + id, function () {
			if (this.find({route: route, method: this.model.method}).length) {
				return;
			}

			this.addChild(new Permission({
				superview: this.permissionList,
				route: route,
				user: this.model.user
			}))
		})
	}
});

var Permission = Spineless.View.extend({
	tag: "row",
	
	defaults: {
		"route": "",
		"user": ""
	},

	template: [
		{tag: "span", id: "route"},
		{tag: "select", id: "user", children: accessOptions},
		{tag: "button", id: "cancel", text: "", title: "Remove permission"}
	],

	events: {
		"click cancel": "onCancel"
	},

	init: function (opts) {
		Permission.super(this, "init", arguments);
		this.user.value = this.model.user;

		this.on("change:user", function (val) {
			var d = {};
			d[this.model.route] = val;
			this.post("/admin/permissions", d);
		});
	},

	render: function () {
		this.route.textContent = this.model.route;
	},

	onCancel: function () {
		this.delete("/admin/permissions", {route: this.model.route});
		this.once("sync:delete", function () {
			this.removeFromParent();
		});
	}
});

$(".permissions").click(function () {
	$("#page").empty();
	if (p) {
		p.removeFromParent();
	}

	p = new PermissionController({
		superview: "page"
	});	
});