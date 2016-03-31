var RedisPool = require('redis-mpool');
var _ = require('underscore');
var mapnik = require('mapnik');
var windshaft = require('windshaft');

var MapController = require('./controllers/map');

global.environment = require('./config');

var config = {
  base_url_mapconfig: '/tiles',
  grainstore: {
    datasource: {
      user: 'domegis',
      host: '/var/run/postgresql',
      port: 5432,
      geometry_field: 'the_geom'
    }
  },
  redis: {host: '127.0.0.1', port: 6379},
  enable_cors: true,
  req2params: function(req, callback){

    req.params.dbuser = 'domegis';
    req.params.dbname = 'domegis';
    req.params.dbpassword = 'domegis';

    // this is in case you want to test sql parameters eg ...png?sql=select * from my_table limit 10
    req.params =  _.extend({}, req.params);
    _.extend(req.params, req.query);

    // send the finished req object on
    callback(null,req);

  }

};

module.exports = function() {

  var app = this;

  init(app, config);

};

// init(app, );

function init(app, opts) {

  opts = opts || {};

  opts.grainstore = opts.grainstore || {};
  opts.grainstore.mapnik_version = mapnikVersion(opts);

  bootstrapFonts(opts);

  addFilters(app, opts);

  var redisPool = makeRedisPool(opts.redis);

  var map_store  = new windshaft.storage.MapStore({
    pool: redisPool,
    expire_time: opts.grainstore.default_layergroup_ttl
  });

  opts.renderer = opts.renderer || {};

  var rendererFactory = new windshaft.renderer.Factory({
    onTileErrorStrategy: opts.renderer.onTileErrorStrategy,
    mapnik: {
      grainstore: opts.grainstore,
      mapnik: opts.renderer.mapnik || opts.mapnik
    },
    torque: opts.renderer.torque,
    http: opts.renderer.http
  });

  // initialize render cache
  var rendererCacheOpts = _.defaults(opts.renderCache || {}, {
    ttl: 60000, // 60 seconds TTL by default
    statsInterval: 60000 // reports stats every milliseconds defined here
  });
  var rendererCache = new windshaft.cache.RendererCache(rendererFactory, rendererCacheOpts);

  var attributesBackend = new windshaft.backend.Attributes();
  var previewBackend = new windshaft.backend.Preview(rendererCache);
  var tileBackend = new windshaft.backend.Tile(rendererCache);
  var mapValidatorBackend = new windshaft.backend.MapValidator(tileBackend, attributesBackend);
  var mapBackend = new windshaft.backend.Map(rendererCache, map_store, mapValidatorBackend);

  app.sendResponse = function(res, args) {
    res.send.apply(res, args);
  };

  app.findStatusCode = function(err) {
    var statusCode;
    if ( err.http_status ) {
      statusCode = err.http_status;
    } else {
      statusCode = statusFromErrorMessage('' + err);
    }
    return statusCode;
  };

  app.sendError = function(res, err, statusCode, label, tolog) {
    var olabel = '[';
    if ( label ) {
      olabel += label + ' ';
    }
    olabel += 'ERROR]';
    if ( ! tolog ) {
      tolog = err;
    }
    var log_msg = olabel + " -- " + statusCode + ": " + tolog;
    //if ( tolog.stack ) log_msg += "\n" + tolog.stack;
    // If a callback was requested, force status to 200
    if ( res.req ) {
      // NOTE: res.req can be undefined when we fake a call to
      //       ourself from POST to /layergroup
      if ( res.req.query.callback ) {
        statusCode = 200;
      }
    }
    // Strip connection info, if any
    // See https://github.com/CartoDB/Windshaft/issues/173
    err = JSON.stringify(err);
    err = err.replace(/Connection string: '[^']*'\\n/, '');
    // See https://travis-ci.org/CartoDB/Windshaft/jobs/20703062#L1644
    err = err.replace(/is the server.*encountered/im, 'encountered');
    err = JSON.parse(err);

    res.status(statusCode).send(err);
  };

  /*******************************************************************************************************************
  * Routing
  ******************************************************************************************************************/

  var mapController = new MapController(app, map_store, mapBackend, tileBackend, attributesBackend);
  mapController.register(app);

  /*******************************************************************************************************************
  * END Routing
  ******************************************************************************************************************/

  // temporary measure until we upgrade to newer version expressjs so we can check err.status
  app.use(function(err, req, res, next) {
    if (err) {
      if (err.name === 'SyntaxError') {
        app.sendError(res, { errors: [err.name + ': ' + err.message] }, 400, 'JSON', err);
      } else {
        next(err);
      }
    } else {
      next();
    }
  });

  return app;
};

function makeRedisPool(redisOpts) {
  redisOpts = redisOpts || {};
  return redisOpts.pool || new RedisPool(_.extend(redisOpts, {name: 'windshaft:server'}));
}

function bootstrapFonts(opts) {
  // Set carto renderer configuration for MMLStore
  opts.grainstore.carto_env = opts.grainstore.carto_env || {};
  var cenv = opts.grainstore.carto_env;
  cenv.validation_data = cenv.validation_data || {};
  if ( ! cenv.validation_data.fonts ) {
    mapnik.register_system_fonts();
    mapnik.register_default_fonts();
    cenv.validation_data.fonts = _.keys(mapnik.fontFiles());
  }
}

function bootstrap(opts) {
  var app;
  if (_.isObject(opts.https)) {
    // use https if possible
    app = express.createServer(opts.https);
  } else {
    // fall back to http by default
    app = express.createServer();
  }
  app.enable('jsonp callback');
  app.use(express.bodyParser());

  if (opts.log_format) {
    var loggerOpts = {
      // Allowing for unbuffered logging is mainly
      // used to avoid hanging during unit testing.
      // TODO: provide an explicit teardown function instead,
      //       releasing any event handler or timer set by
      //       this component.
      buffer: !opts.unbuffered_logging,
      // optional log format
      format: opts.log_format
    };

    app.use(express.logger(loggerOpts));
  }

  return app;
}

// set default before/after filters if not set in opts object
function addFilters(app, opts) {

  // Extend windshaft with all the elements of the options object
  _.extend(app, opts);

  // filters can be used for custom authentication, caching, logging etc
  _.defaults(app, {
    // Enable CORS access by web browsers if set
    doCORS: function(res, extraHeaders) {
      if (opts.enable_cors) {
        var baseHeaders = "X-Requested-With, X-Prototype-Version, X-CSRF-Token";
        if(extraHeaders) {
          baseHeaders += ", " + extraHeaders;
        }
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", baseHeaders);
      }
    },

    getVersion: function() {
      return windshaft.versions;
    }
  });
}

function statusFromErrorMessage(errMsg) {
  // Find an appropriate statusCode based on message
  var statusCode = 400;
  if ( -1 !== errMsg.indexOf('permission denied') ) {
    statusCode = 403;
  }
  else if ( -1 !== errMsg.indexOf('authentication failed') ) {
    statusCode = 403;
  }
  else if (errMsg.match(/Postgis Plugin.*[\s|\n].*column.*does not exist/)) {
    statusCode = 400;
  }
  else if ( -1 !== errMsg.indexOf('does not exist') ) {
    if ( -1 !== errMsg.indexOf(' role ') ) {
      statusCode = 403; // role 'xxx' does not exist
    } else {
      statusCode = 404;
    }
  }
  return statusCode;
}

function mapnikVersion(opts) {
  return opts.grainstore.mapnik_version || mapnik.versions.mapnik;
}
