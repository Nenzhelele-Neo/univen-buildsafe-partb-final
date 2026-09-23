function normalizeRouteText(value) {
  return String(value || "").trim().toLowerCase();
}

function pointToSegmentDistanceMeters(point, start, end) {
  const averageLatitude = (point[0] + start[0] + end[0]) / 3;
  const longitudeScale = 111320 * Math.cos(averageLatitude * Math.PI / 180);
  const toPoint = coordinate => ({
    x: (coordinate[1] - point[1]) * longitudeScale,
    y: (coordinate[0] - point[0]) * 111320
  });
  const a = toPoint(start);
  const b = toPoint(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
  return Math.hypot(a.x + ratio * dx, a.y + ratio * dy);
}

function projectAffectsRoute(project, route) {
  const projectText = [project.location, project.affectedArea].map(normalizeRouteText).filter(Boolean);
  const affectedAreas = (route.affected_areas || []).map(normalizeRouteText);
  if (affectedAreas.some(area => projectText.some(text => text.includes(area) || area.includes(text)))) return true;

  const latitude = Number(project.latitude);
  const longitude = Number(project.longitude);
  const coordinates = route.path_coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Array.isArray(coordinates)) return false;

  for (let index = 1; index < coordinates.length; index += 1) {
    if (pointToSegmentDistanceMeters([latitude, longitude], coordinates[index - 1], coordinates[index]) <= 35) return true;
  }
  return false;
}

function shortestCampusPath(allRoutes, allLocations, startId, destinationId, mode, excludedRouteIds = new Set()) {
  const locationMap = Object.fromEntries(allLocations.map(location => [location.id, location]));
  const adjacency = {};

  allRoutes.forEach(route => {
    if (route.status === "Blocked" || excludedRouteIds.has(route.id)) return;
    if (mode === "walking" && !route.pedestrian_accessible) return;
    if (mode === "vehicle" && !route.vehicle_accessible) return;

    const weight = Number(route.estimated_minutes) + (route.status === "Restricted" ? 2 : 0);
    const forwardCoordinates = route.path_coordinates || [];
    const reverseCoordinates = forwardCoordinates.slice().reverse();
    if (!adjacency[route.start_location_id]) adjacency[route.start_location_id] = [];
    if (!adjacency[route.end_location_id]) adjacency[route.end_location_id] = [];
    adjacency[route.start_location_id].push({ route, to: route.end_location_id, weight, coordinates: forwardCoordinates });
    adjacency[route.end_location_id].push({ route, to: route.start_location_id, weight, coordinates: reverseCoordinates });
  });

  const distances = Object.fromEntries(allLocations.map(location => [location.id, Infinity]));
  const previous = {};
  const queue = [{ id: startId, distance: 0 }];
  const visited = new Set();
  distances[startId] = 0;

  while (queue.length) {
    queue.sort((left, right) => left.distance - right.distance);
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === destinationId) break;

    for (const edge of adjacency[current.id] || []) {
      const distance = distances[current.id] + edge.weight;
      if (distance < distances[edge.to]) {
        distances[edge.to] = distance;
        previous[edge.to] = { from: current.id, edge };
        queue.push({ id: edge.to, distance });
      }
    }
  }

  if (distances[destinationId] === Infinity) return null;

  const segments = [];
  let currentId = destinationId;
  while (currentId !== startId) {
    const step = previous[currentId];
    if (!step) return null;
    segments.unshift(step.edge);
    currentId = step.from;
  }

  const pathCoordinates = [];
  segments.forEach(segment => {
    segment.coordinates.forEach(coordinate => {
      const previousCoordinate = pathCoordinates[pathCoordinates.length - 1];
      if (!previousCoordinate || previousCoordinate[0] !== coordinate[0] || previousCoordinate[1] !== coordinate[1]) {
        pathCoordinates.push(coordinate);
      }
    });
  });

  return {
    routeIds: segments.map(segment => segment.route.id),
    segments: segments.map(segment => ({
      id: segment.route.id,
      name: segment.route.route_name,
      status: segment.route.status,
      type: segment.route.route_type
    })),
    pathCoordinates,
    totalDistanceMeters: segments.reduce((total, segment) => total + Number(segment.route.distance_meters), 0),
    totalEstimatedMinutes: segments.reduce((total, segment) => total + Number(segment.route.estimated_minutes), 0),
    start: locationMap[startId],
    destination: locationMap[destinationId]
  };
}

module.exports = { projectAffectsRoute, shortestCampusPath, pointToSegmentDistanceMeters };
