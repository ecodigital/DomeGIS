'use strict';

angular.module('domegis')

.controller('MainCtrl', [
  '$scope',
  function($scope) {

  }
])

.controller('QueryCtrl', [
  '$scope',
  'Content',
  'esriService',
  function($scope, Content, Esri) {
    $scope.content = Content.data;

    $scope.search = '';
    $scope.params = {
      type: ''
    };

    $scope.availableTypes = Esri.getContentTypes();

    $scope.query = function() {
      Esri.getContent($scope.search, $scope.params).then(function(data) {
        $scope.content = data.data;
      });
    };

    $scope.$watchGroup(['search', 'params'], _.debounce(function() {
      $scope.query();
    }, 500), true);

  }
]);