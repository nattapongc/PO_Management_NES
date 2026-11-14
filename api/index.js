const requestHandler = require('../server.js');

module.exports = async function handler(req, res) {
  return requestHandler(req, res);
};
