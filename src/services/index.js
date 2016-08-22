'use strict';
var authentication = require('./authentication');
var content = require('./content');
var feathersLogger = require('feathers-logger');
var Logger = require('../lib/logger');
var layer = require('./layer');
var logging = require('./logging');
var preview = require('./preview');
var verifyReset = require('./verify-reset');
var search = require('./search');
var Sequelize = require('sequelize');
var user = require('./user');
var view = require('./view');

module.exports = function() {
  var app = this;

  // sequelize with full access
  var sequelize = new Sequelize(app.get('sequelize'), {
    dialect: 'postgres',
    logging: false
  });
  app.set('sequelize', sequelize);

  // sequelize with read only
  var sequelize_readonly = new Sequelize(app.get('sequelize_readonly'), {
    dialect: 'postgres',
    logging: false
  });
  app.set('sequelize_readonly', sequelize_readonly);

  app.configure(authentication);
  app.configure(user);
  app.configure(content);
  app.configure(layer);
  app.configure(preview);
  app.configure(view);
  app.configure(search);
  app.configure(logging);
  app.configure(verifyReset);

  var logger = new Logger({
    app: app,
    sequelize: sequelize
  });
  app.configure(feathersLogger(logger));


  // Setup relationships
  var models = sequelize.models;
  Object.keys(models)
   .map(function(name) { return models[name] })
   .filter(function(model) { return model.associate })
   .forEach(function(model) { return  model.associate(models) } );

  sequelize.sync().then(function(){

    // init admin user
    var Users = app.service('users');
    Users.find({$limit: 1}).then(function(users){

      if (users.total == 0) {
        Users.create({
          name: "First Admin",
          email: "admin@domegis",
          password: "domegis",
          roles: ["admin", "editor"]
        }).then(function(){
          console.log('First admin user created sucessfully, please change its password.');
        }).catch(function(err){
          console.log('Couldn\'t create first user!');
          console.log(err);
        })
      }
    }).catch(function(err){
      console.log('Error creating first admin user:');
      console.log(err);
    });
  });



  // disable windshaft when testing
  if (process.env.NODE_ENV != 'test') {
    app.configure(require('./tiles'));
  }
};
