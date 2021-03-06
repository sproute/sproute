var RouteController = Spineless.View.extend({
	template: [
		{text: "Routes", className: "heading route"},
		{id: "routeList", className: "list"},

		{className: "create", children: [
			{tag: "label", children: [
				{tag: "span", text: "Route: "},
				{tag: "input", id: "route"}
			]},
			
			{tag: "label", children: [
				{tag: "span", text: "Page: "},
				{tag: "select", id: "name"}
			]},

			{tag: "button", id: "submit", text: "Add Route"}
		]}
	],

	events: {
		"click submit": "onSubmit"
	},

	defaults: {
		"name": "",
		"route": ""
	},

	init: function () {
		RouteController.super(this, "init", arguments);

		this.sync("get", "/admin/views");
		this.once("sync:get", function (views) {
			console.log(views)
			//this.template
			for (var i = 0; i < views.length; ++i) {
				views[i] = views[i].substring(0, views[i].lastIndexOf(".sprt"))

				this.name.appendChild(Spineless.View.toDOM({
					tag: "option",
					value: views[i],
					text: views[i]
				}));
			}

			this.model.name = views[0];
			this.views = views;

			this.sync("get", "/admin/controller");
			this.once("sync:get", function (resp) {
				for (var key in resp) {
					var n = resp[key];

					this.addChild(new Route({
						superview: this.routeList,
						route: key,
						name: n,
						views: views
					}))
				}
			});
		});
	},

	onSubmit: function () {
		var d = {};
		d[this.model.route] = this.model.name;
		console.log(d, this.model)
		this.post("/admin/controller", d);
		this.once("sync:post error:post", function () {
			if (this.find({route: this.model.route}).length) {
				return;
			}

			this.addChild(new Route({
				superview: this.routeList,
				route: this.model.route,
				name: this.model.name,
				views: this.views
			}));
		});
	}
});

var Route = Spineless.View.extend({
	tag: "row",
	
	template: [
		{tag: "span", id: "route"},
		{tag: "select", id: "name"},
		{tag: "button", id: "cancel", text: "", title: "Remove route"}
	],

	defaults: {
		"route": "",
		"name": ""
	},

	events: {
		"click cancel": "onCancel"
	},

	onCancel: function () {
		this.delete("/admin/controller", {route: this.model.route})
		this.once("sync:delete error:delete", function () {
			this.removeFromParent();
		});
	},

	init: function (opts) {
		Route.super(this, "init", arguments);

		for (var i = 0; i < opts.views.length; ++i) {
			this.name.appendChild(Spineless.View.toDOM({
				tag: "option",
				value: opts.views[i],
				text: opts.views[i]
			}));
		}

		this.set("name", opts.name);
		this.on("change", function (name, val) {
			var d = {};
			d[this.model.route] = val;
			this.post("/admin/controller", d);
		});
	},

	render: function () {
		this.route.textContent = this.model.route;
	}
});

$(".route").click(function () {
	$("#page").empty();
	if (p) {
		p.removeFromParent();
	}

	p = new RouteController({
		superview: "page"
	});	
})