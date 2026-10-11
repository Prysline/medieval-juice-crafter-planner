import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

BETSY_SUBSETS = [[180,258,418,489,497,536,541,547],[552,554,564,576,595,619,623,632]]
JULIA_SUBSETS = [[60,81,120,124,160,161,163,253,270],[284,287,328,329,330,331,401,419,443]]
BERNARD_CHOICES = [63,132,140,149,171,185,545,568,585,756,1155,1163,1223,1255,1260,1269,1274,1329,1353,1360,1362,1408,1409]
BERNARD_SUBSETS = [BERNARD_CHOICES[:12], BERNARD_CHOICES[12:]]


def prepare():
    exact = json.loads(Path('julia-exact/identity-334-julia-binary-exact-audit.json').read_text())
    routing = json.loads(Path('bernard-routing/identity-334-julia-binary-routing-audit.json').read_text())
    assert exact['complete'] is True
    assert exact['expectedBranches'] == exact['observedBranches'] == 18650
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 4252, 'timelimit': 14398}
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    residuals = exact['branchesByStatus']['timelimit']
    assert len(residuals) == 14398
    assert all(len(x) == 9 and x[-2] in (0,1) and x[-1] in (0,1) for x in residuals)

    assert routing['complete'] is True
    assert routing['sourceJuliaBinaryExactRunId'] == 37753097739
    assert routing['sourceJuliaBinaryExactArtifactId'] == 11548521516
    assert routing['expectedBranches'] == routing['observedBranches'] == 14398
    assert routing['missingBranches'] == routing['unexpectedBranches'] == routing['duplicateBranches'] == routing['malformed'] == []
    assert routing['outerFailures'] == 0
    assert routing['sparseCustomerCounts'] == {'bernard': 14398}
    signatures = sorted(routing['routingSignatures'], key=lambda e: (e['betsySplitIndex'], e['juliaSplitIndex']))
    assert [(e['betsySplitIndex'], e['juliaSplitIndex'], e['branchCount']) for e in signatures] == [(0,0,3624),(0,1,3632),(1,0,3575),(1,1,3567)]
    assert all(e['sparseCustomer'] == 'bernard' for e in signatures)
    assert all([c['groupIndex'] for c in e['candidates']] == BERNARD_CHOICES for e in signatures)
    assert all(all(c['slackOnly'] is False for c in e['candidates']) for e in signatures)
    assert [len(x) for x in BERNARD_SUBSETS] == [12,11]
    assert set(BERNARD_SUBSETS[0]).isdisjoint(BERNARD_SUBSETS[1])

    shards = []
    for i, start in enumerate(range(0, len(residuals), 57), 1):
        parents = residuals[start:start+57]
        shards.append({'shard': i, 'parents_json': json.dumps(parents, separators=(',',':'))})
    assert len(shards) == 253
    assert sum(len(json.loads(s['parents_json'])) for s in shards) == 14398
    assert sum(len(json.loads(s['parents_json'])) * 2 for s in shards) == 28796
    print('matrix=' + json.dumps({'include': shards}, separators=(',',':')))


def patch_source(original: str) -> tuple[str, int, int, str]:
    type_old = "    requiredUsedGroupIndexes?: readonly number[]\n    requiredSlackGroupIndexes?: readonly number[]"
    type_new = "    requiredUsedGroupIndexes?: readonly number[]\n    requiredAnyUsedGroupIndexSets?: readonly (readonly number[])[]\n    requiredSlackGroupIndexes?: readonly number[]"
    assert original.count(type_old) == 1
    patched = original.replace(type_old, type_new)
    d_old = "  const requiredUsedGroupIndexes =\n    options.requiredUsedGroupIndexes ?? []\n  const requiredSlackGroupIndexes ="
    d_new = "  const requiredUsedGroupIndexes =\n    options.requiredUsedGroupIndexes ?? []\n  const requiredAnyUsedGroupIndexSets =\n    options.requiredAnyUsedGroupIndexSets ?? []\n  const requiredSlackGroupIndexes ="
    assert patched.count(d_old) == 1
    patched = patched.replace(d_old, d_new)
    marker = "  requiredSlackGroupIndexes.forEach((groupIndex, index) => {"
    assert patched.count(marker) == 1
    constraint = """  requiredAnyUsedGroupIndexSets.forEach((groupIndexes, setIndex) => {\n    const requiredAnyUsed = groupIndexes.flatMap((groupIndex) => {\n      const used = usedGroupVars[groupIndex]\n      return used ? [used] : []\n    })\n    if (requiredAnyUsed.length !== groupIndexes.length || requiredAnyUsed.length === 0) {\n      model.addConstraint(sum(...usedGroupVars).leq(-1), `s31s_invalid_required_any_used_${setIndex}`)\n      return\n    }\n    model.addConstraint(sum(...requiredAnyUsed).geq(1), `s31s_required_any_used_${setIndex}`)\n  })\n"""
    patched = patched.replace(marker, constraint + marker)
    start_marker = "hallSignatureProfileIt(\n  'profiles Hall-closure membership signatures for unresolved 3+1+1 support',"
    end_marker = "\n  },\n  120000,\n)\n\n\nfunction build311HallSignatureSupportMaster"
    start = patched.find(start_marker); end = patched.find(end_marker, start)
    if start < 0 or end < 0: raise SystemExit('test markers not found')
    return patched, start, end, patched[start:end]


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 57
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-bernard-binary-result] '
    out = []; failed = False; ordinal = 0
    for parent in parents:
        assert len(parent) == 9 and parent[-2] in (0,1) and parent[-1] in (0,1)
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon, betsy_i, julia_i = parent
        for bernard_i, bernard_subset in enumerate(BERNARD_SUBSETS):
            ordinal += 1
            b = json.dumps(BETSY_SUBSETS[betsy_i], separators=(',',':'))
            j = json.dumps(JULIA_SUBSETS[julia_i], separators=(',',':'))
            r = json.dumps(bernard_subset, separators=(',',':'))
            lines = ['',
              '    const fixedExactGroupIndex = 334',
              '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
              '    const fixedExactCustomers = [...fixedExactCustomerSet]',
              '    const requiredPair = [1052, 1070] as const', '    const saviusChoice = 692', '    const ambrosiaChoice = 1243',
              f'    const octaviusChoice = {octavius}', f'    const oliverChoice = {oliver}', f'    const hugoChoice = {hugo}', f'    const tiffanyChoice = {tiffany}', f'    const dominicChoice = {dominic}', f'    const heloiseChoice = {heloise}', f'    const solomonChoice = {solomon}',
              f'    const betsySplitIndex = {betsy_i}', f'    const betsySubset = {b} as const', f'    const juliaSplitIndex = {julia_i}', f'    const juliaSubset = {j} as const', f'    const bernardSplitIndex = {bernard_i}', f'    const bernardSubset = {r} as const',
              "    expect(groups[saviusChoice].eligibleCustomerIds).toContain('savius')", "    expect(groups[ambrosiaChoice].eligibleCustomerIds).toContain('ambrosia')", "    expect(groups[octaviusChoice].eligibleCustomerIds).toContain('octavius')", "    expect(groups[oliverChoice].eligibleCustomerIds).toContain('oliver')", "    expect(groups[hugoChoice].eligibleCustomerIds).toContain('hugo')", "    expect(groups[tiffanyChoice].eligibleCustomerIds).toContain('tiffany')", "    expect(groups[dominicChoice].eligibleCustomerIds).toContain('dominic')", "    expect(groups[heloiseChoice].eligibleCustomerIds).toContain('heloise')", "    expect(groups[solomonChoice].eligibleCustomerIds).toContain('solomon')",
              "    betsySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('betsy'))", "    juliaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('julia'))", "    bernardSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('bernard'))",
              '    const thresholdCounts = [3, 1, 1, 0] as const', '    const supportCuts: number[][] = []', "    let status = 'round-limit'", '    let masterSolveMs = 0', '    let exactSolveMs = 0', '    let exactInfeasibleSupports = 0', '    let fixedSupportExactAttempts = 0',
              '    for (let round = 0; round < 16; round += 1) {',
              '      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, { supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice], requiredAnyUsedGroupIndexSets: [betsySubset, juliaSubset, bernardSubset], requiredExtraOneGroupIndexes: [...requiredPair] })',
              '      const solved = await solveBounded(built.model, 0.5)', '      masterSolveMs += solved.solveMs', "      if (solved.status === 'infeasible') { status = 'infeasible'; break }", "      if (solved.status !== 'optimal' || !solved.namedSolution) { status = solved.status; break }",
              '      const support = groups.flatMap((_group, groupIndex) => { const raw = solved.namedSolution!.get(`s31su_${groupIndex}`); return typeof raw === \'number\' && Number.isFinite(raw) && raw > 0.5 ? [groupIndex] : [] })', "      if (support.length !== 30) throw new Error(`Expected 30 support groups, got ${support.length}`)",
              "      const exact = buildFinalizing30MaskPartitionStage(domain, new Set<ProductionStepKind>(['juicing', 'seasoning', 'blending']), thresholdCounts, { max: 76 }, 0, new Set(support))", '      fixedSupportExactAttempts += 1', '      const exactSolved = await solveBounded(exact.model, 3)', '      exactSolveMs += exactSolved.solveMs', "      if (exactSolved.status === 'infeasible') { exactInfeasibleSupports += 1; supportCuts.push(support); status = 'exact-infeasible-support'; continue }", "      if (exactSolved.status === 'optimal') { status = 'global-witness'; break }", "      status = `exact-${exactSolved.status}`", '      break', '    }',
              "    console.info('[machine-extra1-pair-bernard-binary-result]', JSON.stringify({ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, betsySplitIndex, betsySubset, juliaSplitIndex, juliaSubset, bernardSplitIndex, bernardSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }))"]
            source_path.write_text(patched[:start] + base_test + '\n'.join(lines) + patched[end:])
            cmd=['npx','vitest','run',str(source_path),'--maxWorkers=1','--minWorkers=1','-t',r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support']
            try:
                done=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=150); text=done.stdout; code=done.returncode; timed=False
            except subprocess.TimeoutExpired as exc:
                text=(exc.stdout or '') if isinstance(exc.stdout,str) else (exc.stdout or b'').decode(errors='replace'); code=124; timed=True
            Path(f'branch-{ordinal}.log').write_text(text)
            marked=[ansi.sub('',x) for x in text.splitlines() if marker in ansi.sub('',x)]
            entry={'branch':parent+[bernard_i],'outerReturnCode':code,'outerTimeout':timed,'markerCount':len(marked),'solver':None}
            if len(marked)==1: entry['solver']=json.loads(marked[0][marked[0].find(marker)+len(marker):])
            if code!=0 or len(marked)!=1: failed=True
            out.append(entry)
    source_path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
    if failed: raise SystemExit('one or more Bernard binary exact branches failed')


def audit():
    source=json.loads(Path('julia-exact/identity-334-julia-binary-exact-audit.json').read_text())
    parents=source['branchesByStatus']['timelimit']; assert len(parents)==14398
    expected={tuple(x+[i]) for x in parents for i in (0,1)}
    results={}; duplicates=[]; malformed=[]; outer_failures=[]; outer_timeouts=[]; statuses=Counter(); witnesses=[]
    support_cuts=exact_infeasible_supports=fixed_support_attempts=exact_solve_ms=0
    files=list(Path('exact-shards').rglob('exact-results.json'))
    if len(files)!=253: malformed.append({'reason':'shard-result-count','count':len(files)})
    for path in files:
        entries=json.loads(path.read_text())
        for entry in entries:
            branch=entry.get('branch')
            if not isinstance(branch,list) or len(branch)!=10 or any(x not in (0,1) for x in branch[-3:]): malformed.append({'reason':'branch-shape','branch':branch}); continue
            key=tuple(branch)
            if key in results: duplicates.append(branch); continue
            results[key]=entry
            if entry.get('outerReturnCode')!=0: outer_failures.append(entry)
            if entry.get('outerTimeout'): outer_timeouts.append(entry)
            solver=entry.get('solver')
            if solver is None: continue
            if solver.get('betsySplitIndex')!=branch[-3] or solver.get('juliaSplitIndex')!=branch[-2] or solver.get('bernardSplitIndex')!=branch[-1] or solver.get('bernardSubset')!=BERNARD_SUBSETS[branch[-1]]: malformed.append({'reason':'solver-identity','branch':branch})
            status=solver.get('status')
            if not isinstance(status,str): malformed.append({'reason':'solver-status','branch':branch}); continue
            statuses[status]+=1; support_cuts+=int(solver.get('supportCuts',0)); exact_infeasible_supports+=int(solver.get('exactInfeasibleSupports',0)); fixed_support_attempts+=int(solver.get('fixedSupportExactAttempts',0)); exact_solve_ms+=int(solver.get('exactSolveMs',0))
            if status=='global-witness': witnesses.append(branch)
    observed=set(results); by={}
    for key,entry in results.items():
        s=(entry.get('solver') or {}).get('status')
        if isinstance(s,str): by.setdefault(s,[]).append(list(key))
    for v in by.values(): v.sort()
    summary={'sourceJuliaBinaryExactRunId':37753097739,'sourceJuliaBinaryExactArtifactId':11548521516,'sourceBernardRoutingRunId':37783422241,'sourceBernardRoutingArtifactId':11560475212,'splitKind':'required-any-used-binary','bernardCandidateGroups':BERNARD_CHOICES,'bernardSubsets':BERNARD_SUBSETS,'expectedBranches':len(expected),'observedBranches':len(observed),'missingBranches':sorted([list(x) for x in expected-observed]),'unexpectedBranches':sorted([list(x) for x in observed-expected]),'duplicateBranches':duplicates,'malformed':malformed,'outerFailures':len(outer_failures),'outerTimeouts':len(outer_timeouts),'statuses':dict(sorted(statuses.items())),'exactInfeasibleBranches':statuses.get('infeasible',0),'masterTimeoutBranches':statuses.get('timelimit',0),'roundLimitBranches':statuses.get('round-limit',0)+statuses.get('exact-infeasible-support',0),'fixedSupportTimeoutBranches':statuses.get('exact-timelimit',0),'supportCuts':support_cuts,'exactInfeasibleSupports':exact_infeasible_supports,'fixedSupportExactAttempts':fixed_support_attempts,'exactSolveMs':exact_solve_ms,'witnessCount':len(witnesses),'globalWitnessCount':len(witnesses),'witnesses':witnesses,'branchesByStatus':by,'complete':observed==expected and not duplicates and not malformed and not outer_failures and not outer_timeouts}
    Path('identity-334-bernard-binary-exact-audit.json').write_text(json.dumps(summary,indent=2,sort_keys=True)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='branchesByStatus'},indent=2,sort_keys=True))
    assert summary['complete'] is True


if __name__ == '__main__':
    {'prepare':prepare,'run':run_shard,'audit':audit}[sys.argv[1]]()
