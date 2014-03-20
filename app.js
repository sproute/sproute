var path = require("path");
var util = require("util");
var ff = require("ff");
var rfs = require("fs");
var RiakFS = require("./lib/RiakFS");
var _ = require("underscore");
var express = require("express");
var mathjs = require("mathjs");
var toobusy = require('toobusy');
var nodemailer = require('nodemailer');
var recaptcha = require('simple-recaptcha');

var Storage = require("./storage");
var Greenhouse = require("./greenhouse");
var Error = require("./lib/Error");
var pwd = require("./lib/Hash");

function randString () {
	return ("00000000" + Math.random().toString(36).substr(2)).substr(-11);
}

var ERROR_CODE = 500;

var forgotTemplateHTML = _.template(rfs.readFileSync("./static/mail/lostpass.html").toString());
var forgotTemplateText = _.template(rfs.readFileSync("./static/mail/lostpass.txt").toString());

function App (dir, opts, next) {
	console.log("APP", dir, opts)
	this.dir = dir;
	opts = opts || {};
	this.opts = opts;
	
	this._viewCache = {};
	this._remoteAddrs = {};
	this._sockets = [];

	// use the riak filesystem or
	// the standard filesystem
	if (opts.riakBackend) {
		this.fs = new RiakFS({name: dir})
	} else {
		this.fs = rfs;
		this.dir = dir;
	}

	var f = ff(this, function () {
		this.loadConfig(f.slot());
	}, function () {
		if (opts.loadServer !== false) {
			this.loadServer(opts, f.slot());
		}
	}, function () {
		if (opts.loadModel !== false)
			this.loadModel(f.slot());
	}, function () {
		if (opts.loadPermissions !== false)
			this.loadPermissions(f.slot());
	}, function () {
		if (opts.loadController !== false)
			this.loadController(f.slot());
	}, function () {
		if (opts.loadViews !== false)
			this.loadHook(f.slot());
	}, function () {
		if (opts.loadViews !== false) {
			if (this.config.showAdmin) {
				// load the dashboard files into view cache
				var f2 = ff(this, function () {
					rfs.readFile(path.join(__dirname, "ui/views/dashboard.sprt"), f2.slot());
					rfs.readFile(path.join(__dirname, "ui/views/login.sprt"), f2.slot());
					rfs.readFile(path.join(__dirname, "ui/views/forgot.sprt"), f2.slot());
					rfs.readFile(path.join(__dirname, "ui/views/recover.sprt"), f2.slot());
				}, function (dashboard, login, forgot, recover) {
					this._viewCache["ui/views/dashboard"] = dashboard.toString();
					this._viewCache["ui/views/login"] = login.toString();
					this._viewCache["ui/views/forgot"] = forgot.toString();
					this._viewCache["views/recover"] = recover.toString();

					this.initRoute("/admin", "ui/views/dashboard");
					this.initRoute("/admin/login", "ui/views/login");	
					this.initRoute("/admin/forgot", "ui/views/forgot");	
					this.initRoute("/admin/recover", "ui/views/recover");	
				}).cb(f.slot());
			}
		}
	}, function () {
		if (opts.loadViews !== false) {
			for (var route in this.controller) {
				this.initRoute(route, path.join(this.dir, this.config.views, this.controller[route]));
			}
		}

		if (opts.loadREST !== false)
			this.loadREST(f.slot());
	}, function () {
		if (opts.loadAPI !== false)
			this.loadAPI(f.slot());
	}, function () {
		if (opts.loadMailer !== false)
			this.loadMailer(f.slot());
	}, function () {
		if (this.config.showAdmin) {
			require("./ui/admin").init(this);
		}

		this._restarting = false;
	}).error(function (err) {
		console.error("Error starting Sproute");
		console.error(err);
		console.error(err.stack);
	}).cb(next);
}

App.prototype = {
	/*
	* Load the configuration data. Must exist in a file
	* called "config" and be valid JSON.
	*/
	loadConfig: function (next) {
		this.config = {
			"models": "models",
			"views": "views",
			"controller": "controller.json",
			"extension": "sprt",
			"secret": randString(),
			"static": "public",
			"cacheViews": true,
			"showError": true,
			"showAdmin": (this.opts.showAdmin != undefined ? this.opts.showAdmin : true),
			"strict": true,
			"db": {
				"type": "Riak"
			},
			"mailer": {
				"type": "SMTP",
    			"service": "Gmail",
				"auth": {
					user: process.env.MAIL_USER,
					pass: process.env.MAIL_PASS
				}
			},
			"port": this.opts.port || 8000,
			"csrf": false,
			"rateLimit": 10,
			"reCAPTCHA": "",
			"url": ""
		};

		var f = ff(this, function () {
			this.fs.readFile(path.join(this.dir, "config.json"), f.slot())
		}, function (file) {
			try {
				var c = JSON.parse(file.toString());
				_.extend(this.config, c);
			} catch (e) {
				console.error("Error loading config");
				console.error(e, e.stack);
			}

			// always set the port to opts
			this.config.port = this.opts.port;
			if (!this.config.name) {
				console.error("You must include a `name` parameter in your config.json file");
			}

			this.name = this.config.name;
		}).cb(next);
	},

	/**
	* Configure the Express server from
	* the config data.
	*/
	loadServer: function (opts, next) {
		var server;
		var secret = this.config.secret || (this.config.secret = randString());
		var self = this;

		if (opts.reload && this.server) {
			server = this.server;
			server._router.map = {'get': [], 'post': [], 'delete': []};
			server.routes = server._router.map;
			server.stack.length = 2;
		} else {
			server = express();
		}

		// gracefully handle many requests
		if (this.config.strict) {
			toobusy.maxLag(500);
			server.use(function(req, res, next) {
				if (toobusy()) res.json(503, [{message: "I'm busy right now, sorry."}]);
				else next();
			});

			// rate limit
			server.use(function (req, res, next) {
				if (req.method.toLowerCase() !== "post") { return next(); }

				var ip = req.headers['x-real-ip'] || req.ip;
				if (!ip || ip == "127.0.0.1") { return next(); }

				// currently blocked
				if (self._remoteAddrs[ip] === true) {
					return res.json(420, [{message: "Enhance your calm, bro. Sending too many requests from `"+ip+"`."}])
				}

				self._remoteAddrs[ip] = true;
				setTimeout(function () {
					delete self._remoteAddrs[ip];
				}, self.config.rateLimit * 1000);

				next();
			});
		}

	    server.use(express.cookieParser(secret));

	    // to persist sessions through reload
	    if (!server.sessionHandler) {
		    server.sessionHandler = express.session({
		    	secret: secret, 
		    	cookie: {maxAge: null}
		    });
		}

	    server.use(server.sessionHandler);

		if (this.config.static !== false) {
			var staticDir = path.join(this.dir, this.config.static);
			server.use("/" + this.config.static, express.static(staticDir, { maxAge: 1 }));
		}

	    server.use(express.bodyParser());
	    server.use(express.logger());

	    if (this.config.showAdmin) {
	    	var staticDir = path.join(__dirname, "ui/assets");
	    	server.use("/admin/assets/", express.static(staticDir, { maxAge: 1 }));

	    	server.use("/admin", function (req, res, next) {
	    		if (req.url === "/login" || 
	    			req.url === "/" || 
	    			req.url === "/forgot" ||
	    			req.url === "/recover") { return next(); }

				if (!req.session || !req.session.user || req.session.user.role != "admin") {
					var errorHandler = this.errorHandler(req, res);
					return errorHandler([{message: "You must be admin"}]);
				}

				next();
			}.bind(this));
	    }

	    // enable CORS
		server.use("/data/", function (req, res, n) {
			res.header("Access-Control-Allow-Origin", "*");
			res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
    		res.header("Access-Control-Allow-Headers", "Content-Type");
			
			// preflight request
			if (req.method === "OPTIONS") {
				return res.send(200);
			}

			n();
		});

		if (this.config.reCAPTCHA) {
			server.use(function (req, res, next) {
				if (req.method.toUpperCase() != "POST" || !req.body) return next();

				var challenge = req.body.recaptcha_challenge_field;
				var response = req.body.recaptcha_response_field;

				// detected captcha fields
				if ('recaptcha_challenge_field' in req.body && 
					'recaptcha_response_field' in req.body) {
					recaptcha(
						this.config.reCAPTCHA, 
						req.ip, 
						challenge, 
						response, 
						function (err) {
							if (err) this.errorHandler(req, res)([err]);
							else {
								req.captchaPass = true;
								next();
							}
						}.bind(this)
					);
				} else next();
			}.bind(this));
		}

		// set the content type for firefox os
		server.get("/manifest.webapp", function (req, res, next) {
			res.header("Content-Type", "application/x-web-app-manifest+json");
			next();
		});

		server.get("/internal-sproute-reload", function (req, res) {
			this.reload();
			res.send(200);
		}.bind(this));

		server.get("/internal-sproute-ping", function (req, res) {
			res.send("pong");
		});
		
		if (opts.listen !== false) {
			console.log("Starting server on", this.config.port);
			server.http = server.listen(this.config.port);
		}

		server.use(server.router);
		this.server = server;
		next();
	},

	/**
	* Load the controller JSON file.
	*/
	loadController: function (next) {
		var controllerPath = path.join(this.dir, this.config.controller);

		var f = ff(this, function () {
			this.fs.readFile(controllerPath, f.slot());
		}, function (file) {
			try {
				this.controller = JSON.parse(file.toString());
			} catch (e) {
				console.error("Controller at path: `" + controllerPath + "` not found.");
			}
		}).cb(next);
	},

	/**
	* Load the model structures and initialise
	* the storage instance for this app.
	*/
	loadModel: function (next) {
		var modelPath = path.join(this.dir, this.config.models);
		var structure = {};

		// models are not mandatory so warn in the log
		var f = ff(this, function () {
			this.fs.exists(modelPath, f.slotPlain());
		}, function (exists) {
			if (!exists) {
				console.warn("Models at path `" + modelPath + "` does not exist")
				return;
			}

			this.fs.readdir(modelPath, f.slot());
		}, function (files) {
			
			f.pass(files);
			var g = f.group();

			for (var i = 0; i < files.length; ++i) {
				var file = files[i];
				var table = file.split(".")[0];

				if (!table) { continue; }

				this.fs.readFile(path.join(modelPath, file), g());
			}

		}, function (files, contents) {
			for (var i = 0; i < files.length; ++i) {
				var file = files[i].toString();
				var table = file.split(".")[0];

				if (table == "") {
					files.splice(i--, 1);
					continue; 
				}

				try {
					structure[table] = JSON.parse(contents[i].toString());
				} catch (e) {
					console.error("Error parsing model `%s`", table);
				}
			}
		
			var storage = new Storage({
				name: this.name, 
				schema: structure,
				config: this.config,
				dir: this.dir
			});

			this.structure = structure;
			this.storage = storage;
		}).cb(next);
	},

	/**
	* Load the permissions table and implement
	* some server middleware to validate the
	* permission before passing to the next
	* route handler.
	*/
	loadPermissions: function (next) {
		var permissionsPath = path.join(this.dir, "permissions.json");

		var f = ff(this, function () {
			this.fs.readFile(permissionsPath, f.slot())
		}, function (perms) {
			try {
				this.permissions = JSON.parse(perms);
			} catch (e) {
				console.error("permissions at path: [" + permissionsPath + "] not found.");
				console.error(e);
				console.error(e.stack);
			}

			// loop over the urls in permissions
			Object.keys(this.permissions).forEach(function (url) {
				var parts = url.split(" ");
				if (parts.length < 2) {
					return; //permissions could potentially have >2 params
				}

				var method = parts[0].toLowerCase();
				var route = parts[1];
				var user = this.permissions[url];

				var self = this;
				
				// default method is `all`.
				if (["get", "post", "delete"].indexOf(method) == -1) {
					method = "all";
				}

				this.server[method](route, function (req, res, next) {
					console.log("PERMISSION", method, route, user);
					
					// make sure users don't accidently lock themselves out
					// of the admin login
					if (req.url.indexOf("/api/login") === 0) {
						return next();
					}

					var flag = false;

					//save the required permission and pass it on
					req.permission = user;

					//stranger must NOT be logged in
					if (user === "stranger") {
						if (req.session && req.session.user) {
							flag = true;
						}
					}
					//member or owner must be logged in
					//owner is handled further in the process
					else if (user === "member" || user === "owner") {
						if (!req.session.user) {
							flag = true;
						}
					}
					//no restriction
					else if (user === "anyone") {
						flag = false;
					}
					//custom roles
					else {
						var role = req.session.user && req.session.user.role || "stranger";
						flag = !self.storage.inheritRole(role, user);
					}

					if (flag) {
						var errorHandler = self.errorHandler(req, res);
						return errorHandler([{message: "You do not have permission to complete this action."}]);
					} else next();
				});
				
			}.bind(this));
		}).cb(next);
	},

	loadView: function (view, next) {
		var viewPath = view + "." + this.config.extension;

		var f = ff(this, function () {
			//check the view template exists
			this.fs.exists(viewPath, f.slotPlain());
		}, function (viewExists) {
			//if the view doesn't exist, fail
			if (!viewExists) {
				return f.fail("View template does not exists at: " + viewPath);
			}

			//read the contents of the template
			this.fs.readFile(viewPath, f.slot());
		}, function (template) {
			//cache the view
			this._viewCache[view] = template.toString();
			f.pass(this._viewCache[view])
		}).error(function (e) {
			console.error("Error loading the view template.", "[" + viewPath + "]")
			console.error(e);
		}).cb(next);
	},

	renderView: function (view, data, req, res, next) {
		var body = Object.keys(req.body).length ? req.body : null;

		//build the data to pass into template
		_.extend(data, {
			params: _.extend({}, req.params), 
			query: req.query,
			headers: req.headers,
			session: req.session,
			form: body,
			"$_POST": body, // php-like alias
			"$_GET": req.query,
			self: {
				dir: path.join(this.dir, this.config.views),
				url: req.url,
				method: req.method,
				name: this.name
			}
		});

		if (this.opts.etc) {
			data.self.etc = this.opts.etc;
		}

		var f = ff(this, function () {
			//grab the template from the cache
			if (this.config.cacheViews && view in this._viewCache) {
				f.pass(this._viewCache[view]);
			} else {
				this.loadView(view, f.slot());
			}
		}, function (template) {
			//render and send it back to client
			var g = new Greenhouse(this.hooks, this.fs);
			var slot = f.slot();

			g.oncompiled = function (html) {
				res.send(html);
				slot();
			};

			g.onerror = function (error) {
				slot(error);
			};

			g.onredirect = function (url) {
				res.redirect(url);
				slot();
			};

			g.onjson = function (data) {
				res.json(data);
				slot();
			};

			g.render(template, data);
		}).cb(next);
	},

	/**
	* Setup the routes from the controller. Handle
	* the requests and start an instance of the greenhouse
	* template parser.
	*/
	initRoute: function (route, view) {
		if (!this._viewCache[view]) {
			this.loadView(view);
		}
		
		//handle the route
		var self = this;
		var handler = function (req, res) {
			self.renderView(
				view, 
				{}, 
				req, 
				res, 
				self.errorHandler(req, res)
			);
		};

		// should listen on post and get
		this.server.get(route, handler);
		this.server.post(route, handler);
	},

	testRoute: function (method, url) {
		var routes = this.server.routes[method];
		
		for (var i = 0; i < routes.length; ++i) {
			//see if this route matches
			if (routes[i].regexp.test(url)) {
				var permissionKey = method.toUpperCase() + " " + routes[i].path;
				var userType = this.permissions[permissionKey];

				//return the first matching type
				if (userType) {
					return userType;
				}
			}
		}

		//default to anyone
		return "anyone";
	},

	testPermission: function (permission, user) {
		//stranger must NOT be logged in
		if (permission === "stranger") {
			if (user) {
				return false;
			}
		}
		//member or owner must be logged in
		//owner is handled further in the process
		else if (permission === "member" || permission === "owner") {
			if (!user) {
				return false;
			}
		}
		//no restriction
		else if (permission === "anyone") {
			return true;
		}
		//custom roles
		else {
			var role = user && user.role || "stranger";
			return this.storage.inheritRole(role, permission);
		}

		return true;
	},

	/**
	* Setup hooks into the template parser to
	* return data from the storage engine.
	*/
	loadHook: function (next) {
		var app = this;
		this.hooks = {
			get: function (block, next) {
				//pause parsing and decode request
				var expr = block.expr.split(" ");
				
				var url = expr[0];
				var role = expr[1];
				// as = expr[2]
				var key = expr[3];
				
				// if role has been left out, use current user or stranger
				if (role == 'as') {
					role = false;
					key = expr[2];
				}

				var baseurl = url.split("?")[0];
				
				// see if this url has a permission associated
				var permission = app.testRoute("get", baseurl);

				// if no role is provided, use current
				var session = role ? { user: { role: role } } : this.data.session;

				var allowed = app.testPermission(permission, session.user);
				console.log("\n\nIS ALLOWED", session, allowed, permission)

				// not allowed so give an empty array
				if (!allowed) {
					this.saveDots(key, []);
					return next();
				}

				//request the data then continue parsing
				app.storage.get({
					url: url, 
					permission: permission, 
					session: session
				}, function (err, data) {
					this.saveDots(key, data);
					next();
				}.bind(this));
			},

			post: function (block, next) {
				// pause parsing and decode request
				var expr = block.expr.split(" ");
				
				var url = expr[0];
				var body = expr[1];
				var role = expr[2];
				// as = expr[3]
				var key = expr[4];

				// role has been left out
				if (role == 'as') {
					role = false;
					key = expr[3];
				}

				var baseurl = url.split("?")[0];
				
				// see if this url has a permission associated
				var permission = app.testRoute("post", baseurl);
				var session = role ? { user: { role: role } } : this.data.session;
				var allowed = app.testPermission(permission, session.user);

				// not allowed so give an empty array
				if (!allowed) {
					return next();
				}

				// request the data then continue parsing
				app.storage.post({
					url: baseurl,
					body: this.extractDots(body),
					permission: permission, 
					session: session
				}, function (err, data) {
					if (key) {
						this.saveDots(key, data);
					}

					next();
				}.bind(this));
			},

			expr: function (block, next) {
				var bits = block.rawExpr.indexOf(" ");
				var variable = block.expr.substring(0, bits);

				var expr = this.parseExpression(block.rawExpr.substr(bits + 1), function (n) {
					return parseInt(n, 10) || 0;
				});

				var result = "0";
				try {
					result = mathjs.eval(expr).toString();
				} catch (e) {
					result = "[MathError]";
				}

				this.saveDots(variable, result);
				next();
			},

			debug: function (block, next) {
				var value = this.extractDots(block.rawExpr);
				this.pieces.push("<pre>" + JSON.stringify(value, null, '\t') + "</pre>");
				this.start = block.end + 1;
				next();
			},

			redirect: function (block, next) {
				this.onredirect && this.onredirect.call(this, block.expr);
				return false;
			},

			error: function (block, next) {
				this.onerror && this.onerror.call(this, block.expr);
				return false;
			},

			json: function (block, next) {
				var data = this.extractDots(block.rawExpr);
				this.onjson && this.onjson.call(this, data);
				return false;
			}
		};

		//scan plugins directory
		var pluginPath = path.join(__dirname, "plugins");
		var f = ff(this, function () {
			rfs.exists(pluginPath, f.slotPlain());
		}, function (exists) {
			if (!exists) {
				return this.succeed();
			}

			rfs.readdir(pluginPath, f.slot());
		}, function (files) {
			for (var i = 0; i < files.length; ++i) {
				var file = files[i];
				var table = file.split(".")[0];

				//require the JS file
				var hooks = require(path.join(pluginPath, file));
				console.log("LOAD HOOK", path.join(pluginPath, file), Object.keys(hooks))
				//extend the main hook object
				_.extend(this.hooks, hooks);
			}
		}).cb(next);
	},

	/**
	* Setup the endpoints for the REST interface
	* to the model.
	*/
	loadREST: function (next) {
		//don't use the default REST api for creating a user
		this.server.post(/\/data\/users\/?$/, this.register.bind(this));

		//rest endpoints
		this.server.get("/data/*", this.handleGET.bind(this));
		this.server.post("/data/*", this.handlePOST.bind(this));
		this.server.delete("/data/*", this.handleDELETE.bind(this));

		next();
	},

	loadAPI: function (next) {
		//api endpoints
		this.server.get("/api/logged", this.getLogged.bind(this));
		this.server.post("/api/login", this.login.bind(this));
		this.server.post("/api/update", this.update.bind(this));
		this.server.post("/api/forgot", this.forgot.bind(this));
		this.server.get("/api/logout", this.logout.bind(this));
		this.server.get("/api/recover", this.recover.bind(this));
		this.server.post("/api/register", this.register.bind(this));

		next();
	},

	loadMailer: function (next) {
		var config = _.extend({}, this.config.mailer);
		var type = config.type;
		delete config.type;

		this.mailer = nodemailer.createTransport(type, config);

		next()
	},

	/**
	* REST handlers
	*/
	handleGET: function (req, res) {
		//forward the request to storage
		this.storage.get(req, this.response(req, res));
	},

	handlePOST: function (req, res) {
		//forward the post data to storage
		this.storage.post(req, this.response(req, res));
	},

	handleDELETE: function (req, res) {
		this.storage.delete(req, this.response(req, res));
	},

	/**
	* In-built user account functionality.
	*/
	getLogged: function (req, res) {
		if (req.session && req.session.user) {

			if (req.query.reload) {
				// reload the user object
				this.storage.get({
					url: "/data/users/_id/" + req.session.user._id + "/?single=true",
					session: req.session
				}, function (err, user) {
					req.session.user = _.extend({}, user);
					delete req.session.user.pass;
					delete req.session.user._salt;
					res.json(req.session.user);
				});
			} else {
				res.json(req.session.user); 
			}
		} else {
			res.json(false);
		}
	},

	login: function (req, res) {
		var url = "/data/users/name/" + req.body.name;
		var permission = this.testRoute("get", url);

		var f = ff(this, function () {
			this.storage.db.read("users", {name: req.body.name}, {}, f.slot());
		}, function (data) {
			//no user found, throw error
			if (!data.length) { 
				return f.fail([{message: "No username `"+req.body.name+"` found."}]); 
			}

			if (!req.body.pass) {
				return f.fail([{message: "No password specified."}]);
			}

			var user = data[0];
			f.pass(user);
			pwd.hash(req.body.pass || "", user._salt, f.slot());
		}, function (user, pass) {
			if (user.pass === pass.toString("base64")) {
				req.session.user = _.extend({}, user);
				delete req.session.user.pass;
				delete req.session.user._salt;
				res.json(req.session.user);
			} else {
				return f.fail([{message: "Username and password mismatch."}]); 
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}
		}).error(this.errorHandler(req, res));
	},

	logout: function (req, res) {
		req.session.destroy();
		req.session = null;

		if (req.query.goto) {
			res.redirect(req.query.goto);
		} else {
			res.send(200);
		}
	},

	/**
	* Must go through the /api/register endpoint
	* If logged in, can only create a role equal to or less than current
	* If not, cannot specify role
	*/
	register: function (req, res) {
		var err = [];
		var errorHandler = this.errorHandler(req, res);
		var next = typeof res === "function" && res;

		if (req.session.user) {
			if (req.body.role && !this.storage.inheritRole(req.session.user.role, req.body.role)) {
				err.push({message: "Do not have permission to create the role `"+req.body.role+"`."})
			}
		} else {
			if (req.body.role) {
				err.push({message: "Do not have permission to create the role `"+req.body.role+"`."})
			}
		}

		if (!req.body.name) {
			err.push({message: "No user provided"});
		}

		if (!req.body.pass) {
			err.push({message: "No password provided"});
		}

		if (err.length) { 
			return next ? next(err) : errorHandler(err);
		}

		var f = ff(this, function () {
			pwd.hash(req.body.pass.toString(), f.slot());
		}, function (hash) {
			//add these fields after validation
			req.body._salt = hash[0];
			req.body.pass = hash[1];
			
			this.storage.post({
				url: "/data/users",
				session: req.session,
				permission: req.permission,
				body: req.body
			}, f.slot());
		}, function (data) {
			if (data) { 
				data = data[0]; 

				delete data.pass;
				delete data._salt;
			}

			f.pass(data);
		}).cb(function (err, data) {
			console.log("REGISTER", err, data);
			
			var cb = next ? next : this.response(req, res);
			cb && cb.call(this, err, data);
		});
	},

	update: function (req, res) {
		var err = [];
		var errorHandler = this.errorHandler(req, res);

		if (!req.session || !req.session.user) {
			err.push({message: "Must be logged in"});
		}

		if (!req.body.pass) {
			err.push({message: "No password provided"});
		}

		if (err.length) { 
			return errorHandler(err); 
		}

		var user = req.session.user;

		var f = ff(this, function () {
			this.storage.get({
				url: "/data/users/_id/" + req.session.user._id + "/?single=true",
				session: req.session
			}, f.slot());
		}, function (user) {
			f.pass(user);
			pwd.hash(req.body.pass, user._salt, f.slot());
		}, function (user, pass) {
			// valid password, update details
			if (user.pass === pass.toString("base64")) {
				delete req.body.pass;

				// handle new passwords
				if (req.body.newpass) {
					pwd.hash(req.body.newpass, f.slot());
					delete req.body.newpass;
				}
			} else {
				f.fail({message: "Incorrect password"});
			}
		}, function (hash) {
			if (hash) {
				req.body._salt = hash[0];
				req.body.pass = hash[1];
			}

			this.storage.post({
				url: "/data/users/_id/" + user._id,
				body: req.body,
				session: req.session
			}, f.slot());
		}).cb(this.response(req, res));
	},

	forgot: function (req, res) {
		var f = ff(this, function () {
			this.storage.get({
				url: "/data/users/name/" + req.body.name + "/?single=true",
				session: App.adminSession
			}, f.slot());
		}, function (user) {
			// only allow sending authkey once every 2 hours
			if (user.authkey) {
				var key = parseInt(user.authkey.substring(0, user.authkey.length - 11), 16);
				var diff = key - Date.now();

				if (diff > 0) {
					var hours = diff / 60 / 60 / 1000;
					return f.fail([{message: "Must wait " + hours.toFixed(1) + " hours before sending another recovery email."}]);
				}
			}

			// make sure key is > Date.now()
			var key = (Date.now() + 2 * 60 * 60 * 1000).toString(16);
			key += randString(); // a touch of randomness

			this.storage.post({
				url: "/data/users/name/" + req.body.name,
				body: {authkey: key},
				session: App.adminSession
			});

			var templateData = {
				name: this.name,
				key: key,
				url: this.config.url || "http://" + this.name + ".sproute.io"
			};

			this.mailer.sendMail({
				to: user.name,
				subject: "Recover Sproute Password for " + this.name,
				text: forgotTemplateText(templateData),
				html: forgotTemplateHTML(templateData)
			}, f.slot());
		}).cb(this.response(req, res));
	},

	recover: function (req, res) {
		var errorHandler = this.errorHandler(req, res);

		if (!req.query.auth) {
			return errorHandler([{message: "No authkey provided."}]);
		}

		// could be very invalid keys
		var key = req.query.auth;
		key = parseInt(key.substring(0, key.length - 11), 16);

		var diff = key - Date.now();

		// key has expired
		if (isNaN(diff) || diff <= 0) {
			return errorHandler([{message: "Auth token provided has expired. Send another recovery email."}]);
		}

		// generate a random password
		var newpass = randString();

		var f = ff(this, function () {
			pwd.hash(newpass, f.slot());

			this.storage.get({
				url: "/data/users/authkey/" + req.query.auth + "/?single=true",
				session: App.adminSession
			}, f.slot());
		}, function (hash, user) {
			if (!user) {
				return f.fail([{message: "Cannot find user with that authkey."}])
			}

			// update the new password and clear the key
			this.storage.post({
				url: "/data/users/_id/" + user._id,
				body: {pass: hash[1], _salt: hash[0], authkey: ""},
				session: App.adminSession
			}, f.slot());
		}, function () {
			this.renderView(
				path.join(this.config.views, "recover"), 
				{newpass: newpass}, req, res,
				function (err) {
					err && res.send(200, "Your new password is: " + newpass);
				}
			);
		}).error(errorHandler);
	},

	/**
	* Create a callback function handle a response
	* from the storage instance.
	*/
	response: function (req, res) {
		var self = this;

		return function (err, response) {
			if (err) {
				return self.errorHandler(req, res).call(self, err);
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}

			res.json(response);
		}
	},

	/**
	* Create an error handler function
	*/
	errorHandler: function (req, res) {
		var self = this;
		return function (err) {
			// no error to display
			if (!err) { return false; }

			var error = new Error(err);

			//log to the server
			console.error("-----------");
			console.error("Error occured during %s %s", req.method && req.method.toUpperCase(), req.url)
			if (self.config.showError) {
				console.error(err);
				console.error(error.template)
				if (err.stack) console.error(err.stack);
			}
			console.error("-----------");

			// if json or javascript in accept header, give back JSON
			var acceptJSON = /json|javascript/.test(req.headers.accept || "");
			
			// render the error view
			if (self.config.errorView && !acceptJSON) {
				var errorPath = path.join(self.dir, self.config.views, self.config.errorView);
				ff(function () {
					self.loadView(errorPath, this.slot());
				}, function () {
					self.renderView.call(self, 
						errorPath, 
						{error: error.template}, 
						req, res,
						function (err) {
							// in case of error in error
							if (err) {
								res.json(ERROR_CODE, error.template)
							}
						}
					);
				}).error(function () {
					res.json(ERROR_CODE, error.template)
				});
			} else {
				res.json(ERROR_CODE, error.template);
			}
		}
	},

	reload: function () {
		console.log("\n\n**** RESTARTING ****\n\n");

		this._restarting = true;		
		this.opts.listen = false;
		this.opts.reload = true;
		App.call(this, this.config.name, this.opts, function () {
			console.log("DONE");
		}.bind(this));
	}
};

App.adminSession = {
	user: { role: "admin" }
};

module.exports = App;
