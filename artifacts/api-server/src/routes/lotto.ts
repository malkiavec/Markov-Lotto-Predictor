import { Router, type IRouter } from "express";
import {
  GetLottoAnalysisQueryParams,
  GetLottoAnalysisResponse,
  GetLottoDrawsQueryParams,
  GetLottoDrawsResponse,
  GetLottoGamesQueryParams,
  GetLottoGamesResponse,
  GetLottoStatesResponse,
} from "@workspace/api-zod";
import {
  createLottoAnalysis,
  fetchLottoDraws,
  fetchLottoGames,
  fetchLottoStates,
} from "../lib/lotto";

const router: IRouter = Router();

router.get("/lotto/states", async (req, res): Promise<void> => {
  try {
    const states = await fetchLottoStates();
    res.json(GetLottoStatesResponse.parse(states));
  } catch (error) {
    req.log.error({ err: error }, "NY Lotto state list failed");
    res.status(502).json({
      error: "Could not load states from the lottery provider.",
    });
  }
});

router.get("/lotto/games", async (req, res): Promise<void> => {
  const parsed = GetLottoGamesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const games = await fetchLottoGames(parsed.data.stateCode);
    res.json(GetLottoGamesResponse.parse(games));
  } catch (error) {
    req.log.error(
      { err: error, stateCode: parsed.data.stateCode },
      "NY Lotto state game list failed",
    );
    res.status(502).json({
      error: "Could not load games for that state from the lottery provider.",
    });
  }
});

router.get("/lotto/analysis", async (req, res): Promise<void> => {
  const parsed = GetLottoAnalysisQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const analysis = await createLottoAnalysis(
      parsed.data.limit,
      parsed.data.seed,
      parsed.data.stateCode,
      parsed.data.gameId,
    );
    res.json(GetLottoAnalysisResponse.parse(analysis));
  } catch (error) {
    req.log.error({ err: error }, "NY Lotto analysis failed");
    const message =
      error instanceof Error ? error.message : "Unknown lottery provider error";
    const isSelectionError =
      message.includes("selected state") ||
      message.includes("selected lottery game") ||
      message.includes("selected game");
    res.status(isSelectionError ? 400 : 502).json({
      error: isSelectionError
        ? message
        : "The lottery data provider is unavailable or its RapidAPI plan is not subscribed to this API.",
    });
  }
});

router.get("/lotto/draws", async (req, res): Promise<void> => {
  const parsed = GetLottoDrawsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const games = await fetchLottoGames(parsed.data.stateCode);
    const game = games.find((candidate) => candidate.id === parsed.data.gameId);
    if (!game) {
      res.status(400).json({
        error: "That game is not available in the selected state.",
      });
      return;
    }
    const draws = await fetchLottoDraws(game.id, parsed.data.limit, {
      minBall: game.minBall,
      maxBall: game.maxBall,
      picks: game.drawnNumbers,
    });
    res.json(GetLottoDrawsResponse.parse(draws.slice(-parsed.data.limit).reverse()));
  } catch (error) {
    req.log.error(
      { err: error, stateCode: parsed.data.stateCode, gameId: parsed.data.gameId },
      "Recent lottery draws failed",
    );
    res.status(502).json({
      error: "The lottery data provider is unavailable or its RapidAPI plan is not subscribed to this API.",
    });
  }
});

export default router;