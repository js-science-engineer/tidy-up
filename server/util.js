// 通用工具：统一响应与错误
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

// async 路由包装：异常交给全局错误中间件
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, ok, fail, wrap };
