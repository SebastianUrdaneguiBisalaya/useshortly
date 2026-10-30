import type { GeoGeometryObjects } from 'd3-geo';

type Ring = number[][];

/** Signed planar area of a ring in lon/lat (y up): positive when counter-clockwise. */
function signedArea(ring: Ring): number {
	let sum = 0;
	for (let index = 0; index < ring.length; index++) {
		const [x1, y1] = ring[index];
		const [x2, y2] = ring[(index + 1) % ring.length];
		sum += x1 * y2 - x2 * y1;
	}
	return sum / 2;
}

/**
 * d3-geo works on the sphere, where winding decides which side of a ring is
 * "inside": an exterior ring wound the wrong way fills the whole globe instead
 * of the polygon. d3 expects exterior rings clockwise and holes
 * counter-clockwise, but GeoJSON written by other tools (RFC 7946 says the
 * opposite, and many files ignore it) can be either — so every ring is
 * normalized here, and the input is never mutated.
 */
function rewindPolygon(rings: Ring[]): Ring[] {
	return rings.map((ring, index) => {
		const clockwise = signedArea(ring) < 0;
		return clockwise === (index === 0) ? ring : [...ring].reverse();
	});
}

/** Returns `geometry` with every polygon ring wound the way d3-geo expects. */
export function rewindGeometry(geometry: GeoGeometryObjects): GeoGeometryObjects {
	switch (geometry.type) {
		case 'Polygon':
			return {
				...geometry,
				coordinates: rewindPolygon(geometry.coordinates),
			};
		case 'MultiPolygon':
			return {
				...geometry,
				coordinates: geometry.coordinates.map(rewindPolygon),
			};
		case 'GeometryCollection':
			return {
				...geometry,
				geometries: geometry.geometries.map(member => rewindGeometry(member as GeoGeometryObjects) as typeof member),
			};
		default:
			return geometry;
	}
}
