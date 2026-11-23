import type {
  PlotLabAction,
  PlotLabInterviewCheckpoint,
  PlotLabMessage,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";

export const PLOT_LAB_MAX_CREATIVE_QUESTIONS = 4;

const QUESTIONS = [
  "What about the lead character in Episode 1 must remain true as this story expands?",
  "What do they want badly enough to make a costly choice in the next story movement?",
  "Which relationship should create the strongest emotional pressure on that choice?",
  "What consequence should make the first batch feel impossible to walk back from?",
] as const;

const STARTERS = [
  ["Protect their defining contradiction", "Protect their emotional wound"],
  ["They choose belonging over safety", "They choose control over trust"],
  ["An intimate ally applies pressure", "A powerful rival applies pressure"],
  ["A private betrayal becomes public", "A temporary win creates a larger debt"],
] as const;

type NewMessage = Omit<PlotLabMessage, "sequence" | "createdAt">;

function questionMessage(
  sessionId: string,
  actionId: string,
  questionNumber: number,
  dependencyIds: string[]
): NewMessage {
  const index = Math.min(Math.max(questionNumber, 1), PLOT_LAB_MAX_CREATIVE_QUESTIONS) - 1;
  return {
    id: `${actionId}:question:${questionNumber}`,
    sessionId,
    role: "levi",
    kind: "interview_question",
    content: QUESTIONS[index],
    payload: {
      questionNumber,
      starters: STARTERS[index].map((text, starterIndex) => ({
        id: `${actionId}:starter:${questionNumber}:${starterIndex + 1}`,
        text,
      })),
    },
    actionId,
    dependencyIds,
    replayScope: "derived",
  };
}

export interface MockPlotLabTurn {
  leviMessages: NewMessage[];
  checkpoint: PlotLabInterviewCheckpoint;
  response: Record<string, unknown>;
}

export function createMockPlotLabTurn(input: {
  session: PlotLabSessionState;
  actionId: string;
  action: PlotLabAction;
  writerMessageId?: string;
  editedQuestionNumber?: number;
}): MockPlotLabTurn {
  const { session, actionId, action, writerMessageId } = input;
  const dependencyIds = writerMessageId ? [writerMessageId] : [];

  if (action.kind === "start") {
    const question = questionMessage(session.sessionId, actionId, 1, dependencyIds);
    return {
      leviMessages: [question],
      checkpoint: {
        creativeQuestionCount: 1,
        readyForCreative: false,
        latestQuestionMessageId: question.id,
      },
      response: { kind: "question", questionMessageId: question.id },
    };
  }

  if (action.kind === "answer" || action.kind === "edit_answer") {
    const answeredQuestion =
      action.kind === "edit_answer"
        ? input.editedQuestionNumber ?? 1
        : session.interviewCheckpoint.creativeQuestionCount;
    if (answeredQuestion >= PLOT_LAB_MAX_CREATIVE_QUESTIONS) {
      const ready: NewMessage = {
        id: `${actionId}:ready`,
        sessionId: session.sessionId,
        role: "levi",
        kind: "interview_ready",
        content: "I have enough to shape the first connected batch. You can generate now or add more context.",
        actionId,
        dependencyIds,
        replayScope: "derived",
      };
      return {
        leviMessages: [ready],
        checkpoint: {
          creativeQuestionCount: PLOT_LAB_MAX_CREATIVE_QUESTIONS,
          readyForCreative: true,
        },
        response: { kind: "ready" },
      };
    }
    const nextNumber = answeredQuestion + 1;
    const question = questionMessage(session.sessionId, actionId, nextNumber, dependencyIds);
    return {
      leviMessages: [question],
      checkpoint: {
        creativeQuestionCount: nextNumber,
        readyForCreative: false,
        latestQuestionMessageId: question.id,
      },
      response: { kind: "question", questionMessageId: question.id },
    };
  }

  if (action.kind === "request_generation") {
    if (!session.interviewCheckpoint.readyForCreative) {
      const count = Math.min(
        Math.max(session.interviewCheckpoint.creativeQuestionCount, 1),
        PLOT_LAB_MAX_CREATIVE_QUESTIONS
      );
      const question = questionMessage(session.sessionId, actionId, count, dependencyIds);
      return {
        leviMessages: [question],
        checkpoint: {
          creativeQuestionCount: count,
          readyForCreative: false,
          latestQuestionMessageId: question.id,
        },
        response: { kind: "blocking_question", questionMessageId: question.id },
      };
    }
    const message: NewMessage = {
      id: `${actionId}:generation-ready`,
      sessionId: session.sessionId,
      role: "system",
      kind: "mock_generation_ready",
      content: "The interview packet is ready. Durable generation is intentionally disabled in this mocked API phase.",
      actionId,
      dependencyIds,
      replayScope: "derived",
    };
    return {
      leviMessages: [message],
      checkpoint: session.interviewCheckpoint,
      response: { kind: "mock_generation_ready" },
    };
  }

  const acknowledgement: NewMessage = {
    id: `${actionId}:ack`,
    sessionId: session.sessionId,
    role: "levi",
    kind: "context_acknowledged",
    content: "Context saved. I’ll keep it in the working session.",
    actionId,
    dependencyIds: [],
    replayScope: "session",
  };
  return {
    leviMessages: [acknowledgement],
    checkpoint: session.interviewCheckpoint,
    response: { kind: "acknowledged" },
  };
}
