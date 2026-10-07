const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (key === "$and") return value.every(part => matches(row, part));
  if (key === "$or") return value.some(part => matches(row, part));
  const actual = key.split('.').reduce((item, field) => item?.[field], row);
  if (value && typeof value === "object") {
    if ('$in' in value) return value.$in.includes(actual);
    if ('$exists' in value) return (actual !== undefined) === value.$exists;
  }
  return value === null ? actual == null : String(actual) === String(value);
});
const queryChain = (rows, filter) => {
  let skip = 0, limit = Number.MAX_SAFE_INTEGER;
  return { sort() { return this; }, skip(value) { skip = value; return this; }, limit(value) { limit = value; return this; },
    then(resolve, reject) { return Promise.resolve(rows.filter(row => matches(row, filter)).slice(skip, skip + limit)).then(resolve, reject); } };
};
module.exports = { matches, queryChain };
