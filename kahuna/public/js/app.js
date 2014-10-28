// TODO: Grunt: hash dependencies? or ETag?
// TODO: Load templates using AMD so they can be compiled in

import angular from 'angular';
import 'angular-ui-router';
import 'services/api/media-api';
import 'services/api/media-cropper';
import 'services/api/loader';
import 'directives/ui-crop-box';

var apiLink = document.querySelector('link[rel="media-api-uri"]');
var config = {
    mediaApiUri: apiLink.getAttribute('href')
};

var kahuna = angular.module('kahuna', [
    'ui.router',
    'kahuna.services.api',
    'kahuna.directives'
]);


// Inject configuration values into the app
angular.forEach(config, function(value, key) {
    kahuna.constant(key, value);
});

kahuna.config(['$locationProvider',
               function($locationProvider) {

    // Use real URLs (with History API) instead of hashbangs
    $locationProvider.html5Mode(true).hashPrefix('!');
}]);

kahuna.config(['$stateProvider', '$urlRouterProvider',
               function($stateProvider, $urlRouterProvider) {

    var templatesDirectory = '/assets/templates';
    $stateProvider.state('search', {
        // Virtual state, we always want to be in a child state of this
        abstract: true,
        url: '/',
        templateUrl: templatesDirectory + '/search.html'
    });
    $stateProvider.state('search.results', {
        url: 'search?query&since&free&archived',
        templateUrl: templatesDirectory + '/search/results.html',
        controller: 'SearchResultsCtrl',
        data: {
            title: function(params) {
                return params.query ? params.query : 'search';
            }
        }
    });

    $stateProvider.state('image', {
        url: '/images/:imageId?crop',
        templateUrl: templatesDirectory + '/image.html',
        controller: 'ImageCtrl'
    });

    $stateProvider.state('crop', {
        url: '/images/:imageId/crop',
        templateUrl: templatesDirectory + '/crop.html',
        controller: 'ImageCropCtrl as imageCropCtrl'
    });

    $urlRouterProvider.otherwise("/search");
}]);


kahuna.controller('SearchQueryCtrl',
                  ['$scope', '$state', '$stateParams',
                   function($scope, $state, $stateParams) {

    // a little annoying as the params are returned as strings
    $scope.free = $stateParams.free !== 'false';
    $scope.query = $stateParams.query;
    $scope.since = $stateParams.since;
    $scope.archived = $stateParams.archived;

    // Update state from search filters (skip initialisation step)
    $scope.$watch('query', function(query, oldQuery) {
        if (query !== oldQuery) {
            $state.go('search.results', {query: query});
        }
    });
    $scope.$watch('since', function(since, oldSince) {
        if (since !== oldSince) {
            $state.go('search.results', {since: since});
        }
    });
    $scope.$watch('free', function(free, oldFree) {
        if (free !== oldFree) {
            $state.go('search.results', {free: free});
        }
    });
    $scope.$watch('archived', function(archived, oldArchived) {
        if (archived !== oldArchived) {
            $state.go('search.results', {archived: archived});
        }
    });

}]);


kahuna.controller('SearchResultsCtrl',
                  ['$scope', '$state', '$stateParams', '$timeout', 'mediaApi',
                   function($scope, $state, $stateParams, $timeout, mediaApi) {

    $scope.images = [];

    // FIXME: This is being refreshed by the router. Make it watch a $stateParams collection instead
    // See:   https://github.com/guardian/media-service/pull/64#discussion-diff-17351746L116
    // FIXME: make addImages generic enough to run on first load so as not to duplicate here
    $scope.searched = mediaApi.search($stateParams.query, {
        since: $stateParams.since,
        archived: $stateParams.archived
    }).then(function(images) {
        $scope.images = images;
        // yield so images render before we check if there's more space
        $timeout(function() {
            if ($scope.hasSpace) {
                addImages();
            }
        });
    });

    $scope.freeImageFilter = function(image) {
       return $stateParams.free === 'false' || image.data.cost === 'free';
    };

    var seenSince;
    var lastSeenKey = 'search.seenFrom';
    $scope.getLastSeenVal = function(image) {
        var key = getQueryKey();
        var val = {};
        val[key] = image.data.uploadTime;

        return val;
    };

    $scope.imageHasBeenSeen = function(image) {
        return image.data.uploadTime <= seenSince;
    };

    $scope.$watch(() => localStorage.getItem(lastSeenKey), function() {
        seenSince = getSeenSince();
    });

    // TODO: Move this into localstore service
    function getSeenSince() {
       return JSON.parse(localStorage.getItem(lastSeenKey) || '{}')[getQueryKey()];
    }

    $scope.$watch('nearBottom', function(nearBottom) {
        if (nearBottom) {
            addImages();
        }
    });

    function getQueryKey() {
        return $stateParams.query || '*';
    }

    function addImages() {
        // TODO: stop once reached the end
        var lastImage = $scope.images.slice(-1)[0];
        if (lastImage) {
            var until = lastImage.data.uploadTime;
            return mediaApi.search($stateParams.query, {
                until: until,
                archived: $stateParams.archived
            }).then(function(moreImages) {
                // Filter out duplicates (esp. on exact same 'until' date)
                var newImages = moreImages.filter(function(im) {
                    return $scope.images.filter(function(existing) {
                        return existing.uri === im.uri;
                    }).length === 0;
                });
                $scope.images = $scope.images.concat(newImages);

                // FIXME: this is increasingly hacky logic to ensure
                // we bring in more images that satisfy the cost
                // filter

                // If there are more images, just not any matching our cost filter, get moar!
                var filteredImages = newImages.filter($scope.freeImageFilter);
                if (filteredImages.length === 0 && newImages.length > 0) {
                    addImages();
                }
            });
        }
    }

    $scope.whenNearBottom = addImages;
}]);

kahuna.controller('ImageCtrl',
                  ['$scope', '$stateParams', '$filter', 'mediaApi', 'mediaCropper',
                   function($scope, $stateParams, $filter, mediaApi, mediaCropper) {

    var imageId = $stateParams.imageId;
    $scope.cropKey = $stateParams.crop;

    mediaApi.find(imageId).then(function(image) {
        var getCropKey = $filter('getCropKey');

        $scope.image = image;

        mediaCropper.getCropsFor(image).then(function(crops) {
           $scope.crops = crops;
           $scope.crop = crops.find(crop => getCropKey(crop) === $scope.cropKey);
        });
    });

    var ignoredMetadata = ['description', 'source', 'copyright', 'keywords'];
    $scope.isUsefulMetadata = function(metadataKey) {
        return ignoredMetadata.indexOf(metadataKey) === -1;
    };

    $scope.priorityMetadata = ['byline', 'credit'];
}]);

kahuna.controller('ImageCropCtrl',
                  ['$scope', '$stateParams', '$state', '$filter', 'mediaApi', 'mediaCropper',
                   function($scope, $stateParams, $state, $filter, mediaApi, mediaCropper) {

    var imageId = $stateParams.imageId;

    mediaApi.find(imageId).then(function(image) {
        $scope.image = image;
    });

    $scope.cropping = false;

    // Standard ratios
    $scope.landscapeRatio = 5 / 3;
    $scope.portraitRatio = 2 / 3;
    $scope.freeRatio = null;

    // TODO: migrate the other properties to be on the ctrl (this) instead of $scope
    this.aspect = $scope.landscapeRatio;
    $scope.coords = {
        x1: 0,
        y1: 0,
        // max out to fill the image with the selection
        x2: 10000,
        y2: 10000
    };

    $scope.crop = function() {
        // TODO: show crop
        var coords = {
            x: $scope.coords.x1,
            y: $scope.coords.y1,
            width:  $scope.coords.x2 - $scope.coords.x1,
            height: $scope.coords.y2 - $scope.coords.y1
        };

        var ratio;
        if (Number(this.aspect) === $scope.landscapeRatio) {
            ratio = '5:3';
        } else if (Number(this.aspect) === $scope.portraitRatio) {
            ratio = '3:2';
        }

        $scope.cropping = true;

        mediaCropper.createCrop($scope.image, coords, ratio).then(function(crop) {
            $state.go('image', {
                imageId: imageId,
                crop: $filter('getCropKey')(crop.data)
            });
        }).finally(function() {
            $scope.cropping = false;
        });
    }.bind(this);

}]);

kahuna.controller('UploadCtrl', ['$http', 'loaderApi', function($http, loaderApi) {
    this.files = [];
    this.uploadFiles = function(files) {
        files.forEach((file) => {
            var reader = new FileReader();
            reader.addEventListener('load', (event) => uploadFile(event.target.result));
            reader.readAsArrayBuffer(file);
        });
    };

    function uploadFile(file) {
        loaderApi.load(new Uint8Array(file));
    }
}]);

// Create the key form the bounds as that's what we have in S3
kahuna.filter('getCropKey', function() {
    return function(crop) {
        var bounds = crop.specification.bounds;
        return ['x', 'y', 'width', 'height'].map(k => bounds[k]).join('_');
    };
});


kahuna.filter('getExtremeAssets', function() {
    return function(image) {
        var orderedAssets = image.assets.sort((a, b) => {
            return (a.dimensions.width * a.dimensions.height) -
                   (b.dimensions.width * b.dimensions.height);
        });

        return {
            smallest: orderedAssets[0],
            largest: orderedAssets.slice(-1)[0]
        };
    };
});

// Take an image and return a drag data map of mime-type -> value
kahuna.filter('asImageDragData', function() {
    return function(image) {
        var url = image && image.uri;
        if (url) {
            return {
                'application/vnd.mediaservice.image+json': JSON.stringify(image),
                'text/plain':    url,
                'text/uri-list': url
            };
        }
    };
});

// Take an image and return a drag data map of mime-type -> value
kahuna.filter('asCropsDragData', function() {
    return function(crops) {
        return {
            'application/vnd.mediaservice.crops+json': JSON.stringify(crops)
        };
    };
});

// Take an image and return a drag data map of mime-type -> value
kahuna.filter('asImageAndCropsDragData', ['$filter',
                                          function($filter) {
    var extend = angular.extend;
    return function(image, crops) {
        return extend(
            $filter('asImageDragData')(image),
            $filter('asCropsDragData')(crops));
    };
}]);

kahuna.filter('asAspectRatioWord', function() {
    // FIXME: Try to find one place to store these words to ratios
    return function(aspectRatio) {
        switch(aspectRatio) {
            case '5:3':
                return 'landscape';

            case '3:2':
                return 'portrait';

            default:
                return 'freeform';
        }
    }
});

kahuna.directive('uiHasSpace', ['$window', function($window) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            var el = element[0];
            scope.$watch(function() {
                scope[attrs.uiHasSpace] = el.clientHeight + el.offsetTop <= $window.innerHeight;
            });
        }
    }
}]);

kahuna.directive('uiNearBottom', ['$window', function($window) {
    return {
        restrict: 'A',
        scope: {
            nearBottom: '&uiNearBottom'
        },
        link: function(scope, element, attrs) {
            var scrolling = false;

            angular.element($window).bind('scroll', function(e) {
                // TODO: debounce
                var el = element[0];

                var offset = 200;
                var nowAt = this.innerHeight + this.scrollY;
                var end = el.scrollHeight + el.offsetTop - offset;

                if (!scrolling && nowAt >= end) {
                    scrolling = true;
                    scope.nearBottom().finally(function() {
                        scrolling = false;
                    });
                }
            });
        }
    };
}]);

kahuna.directive('uiDragData', function() {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            element.bind('dragstart', function(jqueryEvent) {
                // Unwrap jQuery event wrapper to access dataTransfer
                var e = jqueryEvent.originalEvent;

                // No obvious way to receive an object through an
                // attribute without making this directive an
                // isolate scope...
                var dataMap = JSON.parse(attrs.uiDragData);
                Object.keys(dataMap).forEach(function(mimeType) {
                    e.dataTransfer.setData(mimeType, dataMap[mimeType]);
                });
            });
        }
    };
});

kahuna.directive('uiDragImage', function() {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            element.bind('dragstart', function(jqueryEvent) {
                // Unwrap jQuery event wrapper to access dataTransfer
                var e = jqueryEvent.originalEvent;
                var img = document.createElement('img');
                img.src = attrs.uiDragImage;
                e.dataTransfer.setDragImage(img, -10, -10);
            });
        }
    };
});

kahuna.directive('uiTitle', function($rootScope) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            $rootScope.$on('$stateChangeStart',
              function(event, toState, toParams, fromState, fromParams) {
                  var title = (toState.data && toState.data.title ? toState.data.title(toParams) : toState.name)
                       + ' | ' + attrs.uiTitleSuffix;

                  element.text(title);
            });
        }
    };
});

/**
 * omitting uiLocalStoreVal will remove the item from localStorage
 * we force localstore attr to be and object
 * TODO: Support deep objects i.e
 * { "search":
 *   { "lastSeen":
 *     { "dogs": "1849-09-26T00:00:00Z" }}}`
 *
 * TODO: Think about what to do if a value
 *       exists for a key that isn't JSON
 *
 * TODO: Make a service for data retrieval?
 */
kahuna.directive('uiLocalstore', function() {
    return {
        restrict: 'A',
        scope: {
            key: '@uiLocalstore',
            value: '&uiLocalstoreVal'
        },
        link: function(scope, element, attrs) {
            element.bind('click', function() {
                var k = scope.key;
                var v = angular.extend({},
                    JSON.parse(localStorage.getItem(k) || '{}'),
                    scope.value()
                );

                if (v) {
                    localStorage.setItem(k, JSON.stringify(v));
                } else {
                    localStorage.removeItem(k);
                }
                scope.$apply();
            });
        }
    };
});

/**
 * this is for when you have dynamic content that makes the window scroll
 * Chrome remembers your last scroll location, so when scrolling starts
 * you get a massive jump on first scroll, good for static content,
 * not for dynamic. This is a craphack.
 *
 * http://stackoverflow.com/questions/18617367/disable-browers-auto-scroll-after-a-page-refresh
 */
kahuna.directive('uiForgetWindowScroll',
                 ['$window', '$timeout',
                  function($window, $timeout) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            scope[attrs.uiForgetWindowScroll].finally(function() {
                // FIXME: even if this is a hack, using timeout as the DOM
                // hasn't loaded is balony.
                $timeout(function() {
                    $window.scrollTo(0, 1);
                    $window.scrollTo(0, 0);
                }, 200);
            });
        }
    };
}]);

kahuna.directive('uiFileSelector', function() {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            var el = element[0];
            el.elements[attrs.uiFileSelectorButton]
                .addEventListener('click', function(event) {
                    event.preventDefault();
                    el.elements[attrs.uiFileSelectorFile].click();
                });
        }
    };
});

kahuna.directive('uiFile', function() {
    return {
        restrict: 'A',
        scope: {
            onchange: '&uiFileChange'
        },
        link: function(scope, element, attrs) {
            element.on('change', function() {
                scope.onchange()(Array.from(element[0].files));
            });
        }
    };
});

angular.bootstrap(document, ['kahuna']);
