export function runtimeProgramPlan(selected, commands) {
  const host = new Set(["git", "node"]);
  const jenaParityMise = new Set();
  for (const id of selected) {
    const [program] = commands[id];
    host.add(program);
    if (program === "cargo") host.add("rustc");
    if (id === "datalogJena" || id === "rdfsJena") {
      host.add("cargo");
      host.add("rustc");
      host.add("java");
      host.add("mvn");
    }
    if (id === "jenaParity") {
      host.add("mise");
      for (const selectedProgram of ["cargo", "java", "mvn", "rustc"]) {
        jenaParityMise.add(selectedProgram);
      }
    }
    if (id === "datalogSouffle") {
      host.add("cargo");
      host.add("rustc");
      host.add("souffle");
    }
    if (id === "owlW3c" || id === "shaclW3c") {
      host.add("cargo");
      host.add("rustc");
    }
    if (id === "shaclJena") {
      host.add("java");
      host.add("mvn");
    }
  }
  return {
    host: [...host].sort(),
    jenaParityMise: [...jenaParityMise].sort(),
  };
}
