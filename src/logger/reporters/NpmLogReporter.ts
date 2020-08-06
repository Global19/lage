import log from "npmlog";
import chalk from "chalk";
import { Reporter } from "./Reporter";
import { LogLevel } from "../LogLevel";
import { LogEntry } from "../LogEntry";
import { formatDuration, hrToSeconds } from "./formatDuration";
import { getTaskId } from "../../task/taskId";
import { RunContext } from "../../types/RunContext";
import { NpmScriptTaskStatus } from "../../task/NpmScriptTask";

const maxLengths = {
  pkg: 0,
  task: 0,
};
const colors = {
  info: chalk.white,
  verbose: chalk.gray,
  warn: chalk.white,
  error: chalk.white,
  task: chalk.cyan,
  pkg: chalk.magenta,
};

function getTaskLogPrefix(pkg: string, task: string) {
  return `${colors.pkg(pkg.padStart(maxLengths.pkg))} ${colors.task(
    task.padStart(maxLengths.task)
  )}`;
}

function normalize(prefixOrMessage: string, message?: string) {
  if (typeof message === "string") {
    const prefix = prefixOrMessage;
    return { prefix, message };
  } else {
    const prefix = "";
    const message = prefixOrMessage;
    return { prefix, message };
  }
}

export class NpmLogReporter implements Reporter {
  readonly groupedEntries = new Map<string, LogEntry[]>();

  constructor(private options: { logLevel?: LogLevel; grouped?: boolean }) {
    options.logLevel = options.logLevel || LogLevel.info;
    log.level = LogLevel[options.logLevel];
  }

  log(entry: LogEntry) {
    if (this.options.logLevel! >= entry.level) {
      const isTaskLogEntry =
        entry.data && entry.data.package && entry.data.task;

      if (isTaskLogEntry && !this.options.grouped) {
        return this.logTaskEntry(
          entry.data!.package!,
          entry.data!.task!,
          entry
        );
      } else if (isTaskLogEntry && this.options.grouped) {
        return this.logTaskEntryInGroup(
          entry.data!.package!,
          entry.data!.task!,
          entry
        );
      } else {
        return this.logGenericEntry(entry);
      }
    }
  }

  private logGenericEntry(entry: LogEntry) {
    const normalizedArgs = normalize(entry.msg);

    const logFn = log[LogLevel[entry.level]];
    const colorFn = colors[LogLevel[entry.level]];

    return logFn(normalizedArgs.prefix, colorFn(normalizedArgs.message));
  }

  private logTaskEntry(pkg: string, task: string, entry: LogEntry) {
    const normalizedArgs = this.options.grouped
      ? normalize(entry.msg)
      : normalize(getTaskLogPrefix(pkg, task), entry.msg);
    const logFn = log[LogLevel[entry.level]];
    const colorFn = colors[LogLevel[entry.level]];

    if (entry.data && entry.data.status) {
      const pkgTask = this.options.grouped
        ? `${chalk.magenta(pkg)} ${chalk.cyan(task)}`
        : "";

      switch (entry.data.status) {
        case "started":
          return logFn(normalizedArgs.prefix, colorFn(`▶️ start ${pkgTask}`));

        case "completed":
          return logFn(
            normalizedArgs.prefix,
            colorFn(
              `✔️ done ${pkgTask} - ${formatDuration(entry.data.duration!)}`
            )
          );

        case "failed":
          return logFn(normalizedArgs.prefix, colorFn(`❌ fail ${pkgTask}`));

        case "skipped":
          return logFn(
            normalizedArgs.prefix,
            colorFn(`⏭️ skip ${pkgTask} - ${entry.data.hash!}`)
          );
      }
    } else {
      return logFn(
        normalizedArgs.prefix,
        colorFn("|  " + normalizedArgs.message)
      );
    }
  }

  private logTaskEntryInGroup(pkg: string, task: string, logEntry: LogEntry) {
    const taskId = getTaskId(pkg, task);

    this.groupedEntries.set(taskId, this.groupedEntries.get(taskId) || []);
    this.groupedEntries.get(taskId)?.push(logEntry);

    if (
      logEntry.data &&
      (logEntry.data.status === "completed" ||
        logEntry.data.status === "failed" ||
        logEntry.data.status === "skipped")
    ) {
      const entries = this.groupedEntries.get(taskId)!;

      for (const entry of entries) {
        this.logTaskEntry(entry.data?.package!, entry.data?.task!, entry);
      }

      if (entries.length > 2) {
        this.hr();
      }
    }
  }

  hr() {
    log.info("", "----------------------------------------------");
  }

  summarize(context: RunContext) {
    const { measures, tasks } = context;
    const { hr } = this;

    const statusColorFn: {
      [status in NpmScriptTaskStatus]: chalk.Chalk;
    } = {
      completed: chalk.greenBright,
      failed: chalk.redBright,
      skipped: chalk.gray,
      started: chalk.gray,
      pending: chalk.gray,
    };

    log.info("", chalk.cyanBright(`🏗 Summary\n`));

    if (measures.failedTask) {
      const { pkg, task } = measures.failedTask;
      const taskId = getTaskId(pkg, task);
      const taskLogs = tasks.get(taskId)?.logger.getLogs();

      log.error("", `ERROR DETECTED IN ${pkg} ${task}`);

      if (taskLogs) {
        log.error("", taskLogs?.map((entry) => entry.msg).join("\n"));
      }

      hr();
    }

    if (tasks.size > 0) {
      for (const npmScriptTask of tasks.values()) {
        const colorFn = statusColorFn[npmScriptTask.status];

        log.info(
          "",
          getTaskLogPrefix(npmScriptTask.info.name, npmScriptTask.task),
          colorFn(
            `${npmScriptTask.status}, took ${formatDuration(
              hrToSeconds(npmScriptTask.duration)
            )}`
          )
        );
      }
    } else {
      log.info("", "Nothing has been run.");
    }

    hr();

    log.info(
      "",
      `Took a total of ${formatDuration(
        hrToSeconds(measures.duration)
      )} to complete`
    );
  }
}
