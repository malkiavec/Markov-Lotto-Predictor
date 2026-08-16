import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lottoRouter from "./lotto";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lottoRouter);

export default router;
