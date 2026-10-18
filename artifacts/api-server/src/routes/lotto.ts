import { Router, type IRouter } from "express";
import {
  GetLottoAnalysisQueryParams,
  GetLottoAnalysisResponse,
  GetLottoDrawsQueryParams,
  GetLottoDrawsResponse,
} from "@workspace/api-zod";
import { createLottoAnalysis, fetchLottoDraws } from "../lib/lotto";

const router: IRouter = Router();

router.get("/lotto/analysis", async (req, res): Promise<void> => {
  const parsed = GetLottoAnalysisQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const analysis = await createLottoAnalysis(parsed.data.limit, parsed.data.seed);
    res.json(GetLottoAnalysisResponse.parse(analysis));
  } catch (error) {
    req.log.error({ err: error }, "NY Lotto analysis failed");
    res.status(502).json({ error: "The NY Lotto data source is temporarily unavailable." });
  }
});

router.get("/lotto/draws", async (req, res): Promise<void> => {
  const parsed = GetLottoDrawsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const draws = await fetchLottoDraws(Math.max(parsed.data.limit, 50));
    res.json(GetLottoDrawsResponse.parse(draws.slice(-parsed.data.limit).reverse()));
  } catch (error) {
    req.log.error({ err: error }, "Recent NY Lotto draws failed");
    res.status(502).json({ error: "The NY Lotto data source is temporarily unavailable." });
  }
});

export default router;