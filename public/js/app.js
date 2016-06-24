angular.module('domegis', [
  'ngCookies',
  'ui.router',
  'ui.sortable',
  'ui.ace',
  'colorpicker.module'
]);

angular.element(document).ready(function() {
  if(self != top) {
    angular.element('body').addClass('iframe');
  }
  angular.element('body').css({display:'block'});
  angular.bootstrap(document, ['domegis']);
});
