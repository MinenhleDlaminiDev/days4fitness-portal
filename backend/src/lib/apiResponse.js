export function sendData(res, data, options = {}) {
  const body = { data };
  if (options.meta) body.meta = options.meta;
  return res.status(options.status || 200).json(body);
}
