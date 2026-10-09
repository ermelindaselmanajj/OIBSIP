const { createPaymentService } = require("../services/payments");

function createPaymentController(service = createPaymentService()) {
  const run = handler => async (req, res) => {
    try { return res.json(await handler(req)); }
    catch (cause) {
      const body = { code: cause.status ? cause.code : "PAYMENT_UNAVAILABLE", message: cause.status ? cause.message : "Payment service is temporarily unavailable. Check status before retrying." };
      if (cause.order) body.order = cause.order;
      return res.status(cause.status || 503).json(body);
    }
  };
  const emptyBody = req => {
    if (req.body !== undefined && (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) {
      throw Object.assign(new Error("Do not provide amounts, currency or payment state. The server calculates and verifies them."), { status: 400, code: "INVALID_PAYMENT_REQUEST" });
    }
  };
  return {
    getPaymentConfig: run(() => service.config()),
    createPayment: run(req => { emptyBody(req); return service.initiate(req.params.id, req.identity._id); }),
    confirmPayment: run(req => service.confirm(req.params.id, req.identity._id, req.body)),
    reconcilePayment: run(req => { emptyBody(req); return service.reconcile(req.params.id, req.identity._id); }),
  };
}

module.exports = { ...createPaymentController(), createPaymentController };
