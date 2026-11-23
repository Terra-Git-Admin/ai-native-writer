import { generateText, jsonSchema, Output } from "ai";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import type {
  PlotLabConnectedBatch,
  PlotLabMessage,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";
import {
  PLOT_LAB_CONNECTOR_PROMPT_VERSION,
  PLOT_LAB_CONNECTOR_SYSTEM_PROMPT,
  PLOT_LAB_CREATIVE_PROMPT_VERSION,
  PLOT_LAB_CREATIVE_SYSTEM_PROMPT,
  PLOT_LAB_INTERVIEWER_PROMPT_VERSION,
  PLOT_LAB_INTERVIEWER_SYSTEM_PROMPT,
} from "@/lib/plot-lab-v2/prompts";

export function isPlotLabRealAIEnabled(): boolean {
  return process.env.PLOT_LAB_REAL_AI_ENABLED === "true";
}

export interface PlotLabModelChoice {
  modelId: string;
  thinking: boolean;
}

interface InterviewOutput {
  ready: boolean;
  message: string;
  question: string;
  starters: string[];
}

interface CreativeOutput {
  units: CreativeUnit[];
}

interface ConnectedOutput {
  units: PlotLabConnectedBatch["units"];
  seedCoverage: PlotLabConnectedBatch["seedCoverage"];
  warnings: string[];
}

const interviewOutput = Output.object({
  name: "plot_lab_interview_turn",
  description: "One Levi interview turn or a ready signal.",
  schema: jsonSchema<InterviewOutput>({
    type: "object",
    additionalProperties: false,
    required: ["ready", "message", "question", "starters"],
    properties: {
      ready: { type: "boolean" },
      message: { type: "string" },
      question: { type: "string" },
      starters: { type: "array", items: { type: "string" }, maxItems: 2 },
    },
  }),
});

const creativeOutput = Output.object({
  name: "plot_lab_creative_route",
  description: "The complete first creative route.",
  schema: jsonSchema<CreativeOutput>({
    type: "object",
    additionalProperties: false,
    required: ["units"],
    properties: {
      units: {
        type: "array",
        minItems: 4,
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["number", "title", "dramaticMove", "characterChoice", "consequence", "endingPressure"],
          properties: {
            number: { type: "integer" },
            title: { type: "string" },
            dramaticMove: { type: "string" },
            characterChoice: { type: "string" },
            consequence: { type: "string" },
            endingPressure: { type: "string" },
          },
        },
      },
    },
  }),
});

const connectedOutput = Output.object({
  name: "plot_lab_connected_batch",
  description: "The final connected story batch shown to the writer.",
  schema: jsonSchema<ConnectedOutput>({
    type: "object",
    additionalProperties: false,
    required: ["units", "seedCoverage", "warnings"],
    properties: {
      units: {
        type: "array",
        minItems: 4,
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "number",
            "title",
            "cause",
            "characterChoice",
            "consequence",
            "nextPressure",
            "emotionalChange",
            "endingTurn",
            "visiblePlot",
          ],
          properties: {
            number: { type: "integer" },
            title: { type: "string" },
            cause: { type: "string" },
            characterChoice: { type: "string" },
            consequence: { type: "string" },
            nextPressure: { type: "string" },
            emotionalChange: { type: "string" },
            endingTurn: { type: "string" },
            visiblePlot: { type: "string" },
          },
        },
      },
      seedCoverage: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["element", "unitNumbers"],
          properties: {
            element: { type: "string" },
            unitNumbers: { type: "array", items: { type: "integer" } },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  }),
});

export async function resolvePlotLabModel(): Promise<PlotLabModelChoice> {
  const providers = await getConfiguredProviders();
  if (providers.includes("openai")) return { modelId: "gpt-5.2", thinking: false };
  if (providers.includes("anthropic")) return { modelId: "claude-sonnet-4-20250514", thinking: false };
  if (providers.includes("google")) return { modelId: "gemini-3.1-pro-preview", thinking: false };
  throw new Error("Configure one AI provider in Admin → AI Settings before starting Plot Lab.");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Levi returned an unreadable response.");
  return JSON.parse(trimmed.slice(first, last + 1));
}

function stringValue(value: unknown, max = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function contextPacket(session: PlotLabSessionState, messages: PlotLabMessage[]): string {
  const references = session.referenceSnapshots.map((reference) => reference.capturedText).filter(Boolean);
  const transcript = messages
    .filter((message) => !message.supersededAt)
    .map((message) => (message.role === "writer" ? "Writer: " : "Levi: ") + message.content)
    .join("\n");
  return JSON.stringify({
    orientation: session.orientation,
    source: session.sourceSnapshot ?? {},
    seed: session.seed ?? "",
    references,
    transcript,
  });
}

export interface RealInterviewTurn {
  ready: boolean;
  message: string;
  question: string;
  starters: [string, string] | [];
}

export async function generateRealInterviewTurn(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
  forceQuestion?: boolean;
}): Promise<RealInterviewTurn> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const instruction = input.forceQuestion
    ? "The writer requested generation, but one blocking decision is still required. Ask exactly that one question."
    : "Decide whether another creative question is genuinely necessary.";
  const result = await generateText({
    model,
    system: PLOT_LAB_INTERVIEWER_SYSTEM_PROMPT,
    prompt: contextPacket(input.session, input.messages) + "\n\n" + instruction,
    output: interviewOutput,
  });
  const parsed = result.output as unknown as Record<string, unknown>;
  const ready = parsed.ready === true && !input.forceQuestion;
  const question = ready ? "" : stringValue(parsed.question, 600);
  const rawStarters = Array.isArray(parsed.starters)
    ? parsed.starters.map((value) => stringValue(value, 300)).filter(Boolean)
    : [];
  if (!ready && (!question || rawStarters.length !== 2)) {
    throw new Error("Levi's interview response was incomplete. Please try again.");
  }
  return {
    ready,
    message: stringValue(parsed.message, 800) || (ready ? "I have enough to build the first route." : question),
    question,
    starters: ready ? [] : [rawStarters[0], rawStarters[1]],
  };
}

export interface CreativeUnit {
  number: number;
  title?: string;
  dramaticMove: string;
  characterChoice: string;
  consequence: string;
  endingPressure: string;
}

function expectedNumbers(orientation: PlotLabSessionState["orientation"], length: number): number[] {
  return orientation === "portrait" ? [2, 3, 4, 5, 6, 7, 8] : Array.from({ length }, (_, index) => index + 1);
}

function validLength(orientation: PlotLabSessionState["orientation"], length: number): boolean {
  return orientation === "portrait" ? length === 7 : length === 4 || length === 5;
}

export function parsePlotLabCreativeResponse(
  text: string,
  orientation: PlotLabSessionState["orientation"]
): CreativeUnit[] {
  const parsed = extractJson(text) as Record<string, unknown>;
  if (!Array.isArray(parsed.units)) throw new Error("Creative route did not contain units.");
  const units = parsed.units.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      number: Number(row.number),
      title: stringValue(row.title, 120) || undefined,
      dramaticMove: stringValue(row.dramaticMove),
      characterChoice: stringValue(row.characterChoice),
      consequence: stringValue(row.consequence),
      endingPressure: stringValue(row.endingPressure),
    };
  });
  const expected = expectedNumbers(orientation, units.length);
  if (
    !validLength(orientation, units.length) ||
    units.some((unit, index) =>
      unit.number !== expected[index] ||
      !unit.dramaticMove ||
      !unit.characterChoice ||
      !unit.consequence ||
      !unit.endingPressure
    )
  ) {
    throw new Error("Creative route did not match the required story range.");
  }
  return units;
}

export function parsePlotLabConnectedResponse(
  text: string,
  orientation: PlotLabSessionState["orientation"],
  version: number
): PlotLabConnectedBatch {
  const parsed = extractJson(text) as Record<string, unknown>;
  if (!Array.isArray(parsed.units)) throw new Error("Connected route did not contain units.");
  const units = parsed.units.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      number: Number(row.number),
      title: stringValue(row.title, 120) || undefined,
      cause: stringValue(row.cause),
      characterChoice: stringValue(row.characterChoice),
      consequence: stringValue(row.consequence),
      nextPressure: stringValue(row.nextPressure),
      emotionalChange: stringValue(row.emotionalChange),
      endingTurn: stringValue(row.endingTurn),
      visiblePlot: stringValue(row.visiblePlot),
    };
  });
  const expected = expectedNumbers(orientation, units.length);
  if (
    !validLength(orientation, units.length) ||
    units.some((unit, index) =>
      unit.number !== expected[index] ||
      !unit.visiblePlot ||
      !unit.characterChoice ||
      !unit.consequence ||
      !unit.endingTurn
    )
  ) {
    throw new Error("Connected route did not match the required final format.");
  }
  const seedCoverage = Array.isArray(parsed.seedCoverage)
    ? parsed.seedCoverage.flatMap((raw) => {
        const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const element = stringValue(row.element, 500);
        const unitNumbers = Array.isArray(row.unitNumbers)
          ? row.unitNumbers.map(Number).filter(Number.isInteger)
          : [];
        return element ? [{ element, unitNumbers }] : [];
      })
    : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((value) => stringValue(value, 500)).filter(Boolean)
    : [];
  return { format: orientation, version, units, seedCoverage, warnings };
}

export async function generateCreativeRoute(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
}): Promise<CreativeUnit[]> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const result = await generateText({
    model,
    system: PLOT_LAB_CREATIVE_SYSTEM_PROMPT,
    prompt: contextPacket(input.session, input.messages),
    output: creativeOutput,
  });
  return parsePlotLabCreativeResponse(
    JSON.stringify(result.output),
    input.session.orientation
  );
}

export async function connectCreativeRoute(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  creativeUnits: CreativeUnit[];
  model: PlotLabModelChoice;
  version: number;
}): Promise<PlotLabConnectedBatch> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const request = {
    model,
    system: PLOT_LAB_CONNECTOR_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      packet: JSON.parse(contextPacket(input.session, input.messages)),
      creativeRoute: input.creativeUnits,
    }),
    output: connectedOutput,
  } as const;
  const result = await generateText(request);
  try {
    return parsePlotLabConnectedResponse(
      JSON.stringify(result.output),
      input.session.orientation,
      input.version
    );
  } catch (validationError) {
    const expectedRange =
      input.session.orientation === "portrait"
        ? "Return exactly seven units numbered 2,3,4,5,6,7,8."
        : "Return four or five units numbered consecutively from 1.";
    const repair = await generateText({
      model,
      system: [
        "Repair the supplied Plot Lab connector JSON without changing its story.",
        expectedRange,
        "Every unit must include number, cause, characterChoice, consequence, nextPressure, emotionalChange, endingTurn, and visiblePlot.",
        "Keep titles when present. Return only the repaired structured object.",
      ].join("\n"),
      prompt: JSON.stringify(result.output),
      output: connectedOutput,
    });
    try {
      return parsePlotLabConnectedResponse(
        JSON.stringify(repair.output),
        input.session.orientation,
        input.version
      );
    } catch {
      throw validationError;
    }
  }
}

export const PLOT_LAB_PROMPT_VERSIONS = {
  interviewer: PLOT_LAB_INTERVIEWER_PROMPT_VERSION,
  creative: PLOT_LAB_CREATIVE_PROMPT_VERSION,
  connector: PLOT_LAB_CONNECTOR_PROMPT_VERSION,
};
