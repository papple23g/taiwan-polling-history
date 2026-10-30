import { commonElectionComparison } from './domain.mjs';
import { publisherBrand, publisherBrandId, publisherGroups } from './publisher-brand.mjs';
import { sortElectionsForDisplay } from './election-navigation.mjs';
export { institutionBrand, institutionGroups } from './publisher-brand.mjs';

export function filterComparisonBrands(comparison, { minimumFiveElections = true } = {}) {
  if (!minimumFiveElections) return comparison;
  return { ...comparison, rows: comparison.mainRows };
}

export function comparisonHistogramMaximum(comparison) {
  const rows = comparison.mainRows && comparison.limitedRows
    ? [...comparison.mainRows, ...comparison.limitedRows] : comparison.rows;
  const maximum = rows.reduce((largest, row) => row.availablePerElection.reduce(
    (value, point) => Number.isFinite(point.mae) ? Math.max(value, point.mae) : value, largest), 0);
  return Math.max(30, Math.ceil(maximum / 10) * 10);
}

export function buildMaeHistogram(points, maximum = 30) {
  if (!Number.isFinite(maximum) || maximum < 2 || maximum % 2 !== 0) return null;
  const bins = Array.from({ length: maximum / 2 }, (_, index) => ({ start: index * 2, end: (index + 1) * 2, count: 0, percentage: 0, points: [] }));
  for (const point of points) {
    if (!Number.isFinite(point.mae) || point.mae < 0 || point.mae > maximum) return null;
    // The final interval includes the shared upper bound; other intervals exclude it.
    const bin = bins[Math.min(Math.floor(point.mae / 2), bins.length - 1)];
    bin.points.push(point);
    bin.count += 1;
  }
  for (const bin of bins) bin.percentage = points.length ? bin.count / points.length * 100 : 0;
  return { bins, total: points.length, maximum };
}

export function compareInstitutionBrands(data, options = {}) {
  options = { within30Days: true, ...options };
  const completed = new Set(data.elections.filter(election => election.phase !== 'pre_result').map(election => election.id));
  const historicalPolls = data.polls.filter(poll => completed.has(poll.electionId));
  const historicalInstitutions = new Set(historicalPolls.map(poll => poll.institutionId));
  data = { ...data, elections: data.elections.filter(election => completed.has(election.id)), polls: historicalPolls, institutions: data.institutions.filter(institution => historicalInstitutions.has(institution.id)) };
  const groups = publisherGroups(data.polls, data.institutions);
  const byInstitution = new Map(data.institutions.map(institution => [institution.id, institution]));
  // Group only the comparison view; original poll IDs, institutions and source records stay intact.
  const grouped = { ...data, polls: data.polls.map(poll => ({ ...poll, institutionId: publisherBrandId(publisherBrand(poll, byInstitution.get(poll.institutionId))) })) };
  const comparison = commonElectionComparison(grouped, groups.map(group => group.id), { ...options, includeRecorded: true });
  const availableIds = new Set(comparison.rows.flatMap(row => row.availableElectionIds));
  const displayElectionIds = sortElectionsForDisplay(data.elections).map(election => election.id).filter(id => availableIds.has(id));
  const rows = comparison.rows.map((row, index) => {
    const scores = row.availablePerElection.map(point => point.mae).sort((a, b) => a - b);
    const count = scores.length;
    const middle = Math.floor(count / 2);
    return {
      ...row, brand: groups[index].brand, memberIds: groups[index].memberIds,
      averageCount: count,
      averageElectionIds: [...row.availableElectionIds],
      average: count > 0 ? row.availablePerElection.reduce((sum, point) => sum + point.mae, 0) / count : null,
      median: count > 0 ? count % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2 : null,
      maximum: count > 0 ? scores.at(-1) : null,
    };
  }).sort((a, b) => Number.isFinite(a.average) && Number.isFinite(b.average)
    ? a.average - b.average : Number(Number.isFinite(b.average)) - Number(Number.isFinite(a.average)));
  const mainTableMinimum = 5;
  return { ...comparison, rows, displayElectionIds, minimum: 1, mainTableMinimum,
    mainRows: rows.filter(row => row.averageCount >= mainTableMinimum),
    limitedRows: rows.filter(row => row.averageCount < mainTableMinimum) };
}
