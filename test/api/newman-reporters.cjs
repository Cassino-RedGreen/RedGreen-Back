function CreateNewmanReporterOptions(Case, JsonReport) {
  const Reporters = ['cli'];
  const Reporter = {};

  if (JsonReport) {
    Reporters.push('json');
    Reporter.json = { export: JsonReport };
  }
  if (process.env.TEST_CASE_HTML_REPORT) {
    Reporters.push('htmlextra');
    Reporter.htmlextra = {
      export: process.env.TEST_CASE_HTML_REPORT,
      title: Case,
      skipSensitiveData: true,
    };
  }
  if (process.env.TEST_CASE_JUNIT_REPORT) {
    Reporters.push('junit');
    Reporter.junit = { export: process.env.TEST_CASE_JUNIT_REPORT };
  }
  return { reporters: Reporters, reporter: Reporter };
}

module.exports = { CreateNewmanReporterOptions };
