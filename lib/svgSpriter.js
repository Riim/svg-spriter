var path = require('path');
var fs = require('fs');
var sha1 = require('sha1');
var mustache = require('mustache');
var cheerio = require('cheerio');
var SVGO = require('svgo');
var glob = require('flat-glob');
var mkdirp = require('mkdirp');

module.exports = function(params, cb) {
	var input = params.input;
	var output = params.output;

	Promise.all(glob.sync(input.svg).map(function(svgFile, index) {
		return new Promise(function(resolve) {
			fs.readFile(svgFile, function(err, data) {
				var svgo = new SVGO();

				svgo.optimize(data.toString(), function(res) {
					var svg = cheerio.load(res.data, { xmlMode: true })('svg');
					var viewBox = svg.attr('viewBox').split(' ');

					resolve({
						file: svgFile,
						name: path.basename(svgFile, '.svg'),
						svg: svg,
						position: {},
						width: +(svg.attr('width') || viewBox[2]),
						height: +(svg.attr('height') || viewBox[3])
					});
				});
			});
		});
	})).then(function(shapes) {
		shapes.sort(function(a, b) {
			var aa = a.width;
			var bb = b.width;

			if (aa < bb) { return 1; }
			if (aa > bb) { return -1; }

			aa *= a.height;
			bb *= b.height;

			if (aa < bb) { return 1; }
			if (aa > bb) { return -1; }

			return 0;
		});

		var sprite = cheerio.load([
			'<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
			'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"/>'
		].join(''), { xmlMode: true });
		var spriteSVG = sprite('svg');

		var width = 0;
		var height = 0;

		shapes.forEach(function(shape) {
			var posY = height;

			width = Math.max(width, Math.ceil(shape.width));
			height += Math.ceil(shape.height) + 1;

			var svg = sprite('<svg />')
				.attr({
					id: shape.name,
					x: 0,
					y: posY,
					width: shape.width,
					height: shape.height,
					viewBox: '0 0 ' + shape.width + ' ' + shape.height
				})
				.append(shape.svg.contents());

			spriteSVG.append(svg);

			shape.position.absolute = {
				x: 0,
				y: posY,
				xy: '0 ' + posY + 'px'
			};
		});

		spriteSVG.attr({
			width: width,
			height: height,
			viewBox: '0 0 ' + width + ' ' + height
		});

		shapes.forEach(function(shape) {
			var posY = Math.round(shape.position.absolute.y / (height - shape.height) * 100 * 1000) / 1000;

			shape.position.relative = {
				x: 0,
				y: posY,
				xy: '0 ' + posY + '%'
			};
		});

		var svgo = new SVGO();

		svgo.optimize(sprite.xml(), function(res) {
			var salt = sha1(res.data).slice(-5);
			var spriteFile = output.sprite.replace('{salt}', salt);
			var cssFile = output.css;
			var spriteDir = path.dirname(spriteFile);
			var cssDir = path.dirname(cssFile);

			mkdirp.sync(spriteDir);
			mkdirp.sync(cssDir);

			fs.writeFileSync(spriteFile, res.data, { encoding: 'utf8' });

			var tmpl = fs.readFileSync(input.template, { encoding: 'utf8' });
			var css = mustache.render(tmpl, {
				spriteFile: path.relative(cssDir, spriteFile),
				spriteWidth: width,
				spriteHeight: height,
				shapes: shapes
			});

			fs.writeFileSync(cssFile, css, { encoding: 'utf8' });

			cb();
		});
	});
};
