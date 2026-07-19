// STUB — replaced by the dashboard segment implementation.
import { Router } from "express";

export const dashboardRouter = Router();

dashboardRouter.use((_req, res) => {
  res.status(501).json({ error: "Dashboard routes not implemented yet" });
});
