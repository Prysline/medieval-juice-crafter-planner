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
HARRY_CHOICES = [106,216,220,475,486,493,501,506,515,533,543,559,561,567,573,579,592,599,600,604,637,647,654,659,664]
HARRY_SUBSETS = [HARRY_CHOICES[:13], HARRY_CHOICES[13:]]
EXPECTED_SPARSE_COUNTS = {'harry': 866, 'harvey': 16432, 'lila': 5768}
EXPECTED_CANDIDATES = {
    'harry': HARRY_CHOICES,
    'harvey': [19,204,407,581,590,737,772,776,795,807,816,820,824,828,831,840,1080,1161,1169,1277,1332,1337,1409,1412],
    'lila': [158,233,245,393,725,763,765,781,802,805,809,864,869,870,871,872,888,889,890,891,898,899,901,903],
}


def load_routing_entries():
    files = list(Path('routing-shards').rglob('routing-results.json'))
    assert len(files) == 241
    entries = []
    for path in files:
        shard_entries = json.loads(path.read_text())
        assert 1 <= len(shard_entries) <= 96
        entries.extend(shard_entries)
    return entries


def prepare():
    exact = json.loads(Path('bernard-exact/identity-334-bernard-binary-exact-audit.json').read_text())
    routing_audit = json.loads(Path('bernard-routing-audit/identity-334-bernard-binary-routing-audit.json').read_text())

    assert exact['complete'] is True
    assert exact['expectedBranches'] == exact['observedBranches'] == 28796
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 5730, 'timelimit': 23066}
    assert exact['exactInfeasibleBranches'] == 5730
    assert exact['masterTimeoutBranches'] == 23066
    assert exact['roundLimitBranches'] == 0
    assert exact['fixedSupportTimeoutBranches'] == 0
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    assert exact['witnesses'] == []
    residuals = exact['branchesByStatus']['timelimit']
    assert len(residuals) == 23066
    assert all(len(x) == 10 and all(v in (0, 1) for v in x[-3:]) for x in residuals)
    residual_set = {tuple(x) for x in residuals}
    assert len(residual_set) == 23066

    assert routing_audit['complete'] is True
    assert routing_audit['sourceBernardBinaryExactRunId'] == 37802187352
    assert routing_audit['sourceBernardBinaryExactArtifactId'] == 11574742299
    assert routing_audit['expectedBranches'] == routing_audit['observedBranches'] == 23066
    assert routing_audit['missingBranches'] == routing_audit['unexpectedBranches'] == routing_audit['duplicateBranches'] == routing_audit['malformed'] == []
    assert routing_audit['outerFailures'] == 0
    assert routing_audit['sparseCustomerCounts'] == EXPECTED_SPARSE_COUNTS
    assert len(routing_audit['routingSignatures']) == 24
    for signature in routing_audit['routingSignatures']:
        sparse = signature['sparseCustomer']
        assert sparse in EXPECTED_CANDIDATES
        assert [c['groupIndex'] for c in signature['candidates']] == EXPECTED_CANDIDATES[sparse]
        assert all(c['slackOnly'] is False for c in signature['candidates'])

    entries = load_routing_entries()
    assert len(entries) == 23066
    observed = set()
    harry_parents = []
    sparse_counts = Counter()
    for entry in entries:
        branch = entry.get('branch')
        assert isinstance(branch, list) and len(branch) == 10 and all(v in (0, 1) for v in branch[-3:])
        key = tuple(branch)
        assert key in residual_set
        assert key not in observed
        observed.add(key)
        assert entry.get('outerReturnCode') == 0
        assert entry.get('outerTimeout') is False
        routing = entry.get('routing')
        assert isinstance(routing, dict)
        assert routing.get('betsySplitIndex') == branch[-3]
        assert routing.get('juliaSplitIndex') == branch[-2]
        assert routing.get('bernardSplitIndex') == branch[-1]
        sparse = routing.get('sparseCustomer')
        assert sparse in EXPECTED_CANDIDATES
        candidates = routing.get('candidates')
        assert isinstance(candidates, list)
        assert [c.get('groupIndex') for c in candidates] == EXPECTED_CANDIDATES[sparse]
        assert all(c.get('slackOnly') is False for c in candidates)
        sparse_counts[sparse] += 1
        if sparse == 'harry':
            harry_parents.append(branch)

    assert observed == residual_set
    assert dict(sorted(sparse_counts.items())) == EXPECTED_SPARSE_COUNTS
    harry_parents.sort()
    assert len(harry_parents) == 866
    assert [len(x) for x in HARRY_SUBSETS] == [13, 12]
    assert set(HARRY_SUBSETS[0]).isdisjoint(HARRY_SUBSETS[1])
    assert set(HARRY_SUBSETS[0]) | set(HARRY_SUBSETS[1]) == set(HARRY_CHOICES)

    source = {
        'sourceBernardBinaryExactRunId': 37802187352,
        'sourceBernardBinaryExactArtifactId': 11574742299,
        'sourceBernardBinaryRoutingRunId': 37878996313,
        'sourceBernardBinaryRoutingAuditArtifactId': 11598948284,
        'sparseCustomer': 'harry',
        'candidateGroups': HARRY_CHOICES,
        'subsets': HARRY_SUBSETS,
        'parentBranches': harry_parents,
    }
    Path('identity-334-harry-binary-exact-source.json').write_text(json.dumps(source, indent=2, sort_keys=True) + '\n')

    shards = []
    for i, start in enumerate(range(0, len(harry_parents), 10), 1):
        parents = harry_parents[start:start + 10]
        shards.append({'shard': i, 'parents_json': json.dumps(parents, separators=(',', ':'))})
    assert len(shards) == 87
    assert sum(len(json.loads(s['parents_json'])) for s in shards) == 866
    assert sum(len(json.loads(s['parents_json'])) * 2 for s in shards) == 1732
    assert max(len(json.loads(s['parents_json'])) for s in shards) <= 10
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


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
    start = patched.find(start_marker)
    end = patched.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit('test markers not found')
    return patched, start, end, patched[start:end]


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 10
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-harry-binary-result] '
    out = []
    failed = False
    ordinal = 0

    for parent in parents:
        assert len(parent) == 10 and all(v in (0, 1) for v in parent[-3:])
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon, betsy_i, julia_i, bernard_i = parent
        for harry_i, harry_subset in enumerate(HARRY_SUBSETS):
            ordinal += 1
            b = json.dumps(BETSY_SUBSETS[betsy_i], separators=(',', ':'))
            j = json.dumps(JULIA_SUBSETS[julia_i], separators=(',', ':'))
            r = json.dumps(BERNARD_SUBSETS[bernard_i], separators=(',', ':'))
            h = json.dumps(harry_subset, separators=(',', ':'))
            lines = [
                '',
                '    const fixedExactGroupIndex = 334',
                '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
                '    const fixedExactCustomers = [...fixedExactCustomerSet]',
                '    const requiredPair = [1052, 1070] as const',
                '    const saviusChoice = 692',
                '    const ambrosiaChoice = 1243',
                f'    const octaviusChoice = {octavius}',
                f'    const oliverChoice = {oliver}',
                f'    const hugoChoice = {hugo}',
                f'    const tiffanyChoice = {tiffany}',
                f'    const dominicChoice = {dominic}',
                f'    const heloiseChoice = {heloise}',
                f'    const solomonChoice = {solomon}',
                f'    const betsySplitIndex = {betsy_i}',
                f'    const betsySubset = {b} as const',
                f'    const juliaSplitIndex = {julia_i}',
                f'    const juliaSubset = {j} as const',
                f'    const bernardSplitIndex = {bernard_i}',
                f'    const bernardSubset = {r} as const',
                f'    const harrySplitIndex = {harry_i}',
                f'    const harrySubset = {h} as const',
                "    expect(groups[saviusChoice].eligibleCustomerIds).toContain('savius')",
                "    expect(groups[ambrosiaChoice].eligibleCustomerIds).toContain('ambrosia')",
                "    expect(groups[octaviusChoice].eligibleCustomerIds).toContain('octavius')",
                "    expect(groups[oliverChoice].eligibleCustomerIds).toContain('oliver')",
                "    expect(groups[hugoChoice].eligibleCustomerIds).toContain('hugo')",
                "    expect(groups[tiffanyChoice].eligibleCustomerIds).toContain('tiffany')",
                "    expect(groups[dominicChoice].eligibleCustomerIds).toContain('dominic')",
                "    expect(groups[heloiseChoice].eligibleCustomerIds).toContain('heloise')",
                "    expect(groups[solomonChoice].eligibleCustomerIds).toContain('solomon')",
                "    betsySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('betsy'))",
                "    juliaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('julia'))",
                "    bernardSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('bernard'))",
                "    harrySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('harry'))",
                '    const thresholdCounts = [3, 1, 1, 0] as const',
                '    const supportCuts: number[][] = []',
                "    let status = 'round-limit'",
                '    let masterSolveMs = 0',
                '    let exactSolveMs = 0',
                '    let exactInfeasibleSupports = 0',
                '    let fixedSupportExactAttempts = 0',
                '    for (let round = 0; round < 16; round += 1) {',
                '      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, { supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice], requiredAnyUsedGroupIndexSets: [betsySubset, juliaSubset, bernardSubset, harrySubset], requiredExtraOneGroupIndexes: [...requiredPair] })',
                '      const solved = await solveBounded(built.model, 0.5)',
                '      masterSolveMs += solved.solveMs',
                "      if (solved.status === 'infeasible') { status = 'infeasible'; break }",
                "      if (solved.status !== 'optimal' || !solved.namedSolution) { status = solved.status; break }",
                "      const support = groups.flatMap((_group, groupIndex) => { const raw = solved.namedSolution!.get(`s31su_${groupIndex}`); return typeof raw === 'number' && Number.isFinite(raw) && raw > 0.5 ? [groupIndex] : [] })",
                "      if (support.length !== 30) throw new Error(`Expected 30 support groups, got ${support.length}`)",
                "      const exact = buildFinalizing30MaskPartitionStage(domain, new Set<ProductionStepKind>(['juicing', 'seasoning', 'blending']), thresholdCounts, { max: 76 }, 0, new Set(support))",
                '      fixedSupportExactAttempts += 1',
                '      const exactSolved = await solveBounded(exact.model, 3)',
                '      exactSolveMs += exactSolved.solveMs',
                "      if (exactSolved.status === 'infeasible') { exactInfeasibleSupports += 1; supportCuts.push(support); status = 'exact-infeasible-support'; continue }",
                "      if (exactSolved.status === 'optimal') { status = 'global-witness'; break }",
                "      status = `exact-${exactSolved.status}`",
                '      break',
                '    }',
                "    console.info('[machine-extra1-pair-harry-binary-result]', JSON.stringify({ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, betsySplitIndex, betsySubset, juliaSplitIndex, juliaSubset, bernardSplitIndex, bernardSubset, sparseCustomer: 'harry', harrySplitIndex, harrySubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }))",
            ]
            source_path.write_text(patched[:start] + base_test + '\n'.join(lines) + patched[end:])
            cmd = [
                'npx', 'vitest', 'run', str(source_path), '--maxWorkers=1', '--minWorkers=1',
                '-t', r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support',
            ]
            try:
                done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
                text = done.stdout
                code = done.returncode
                timed = False
            except subprocess.TimeoutExpired as exc:
                text = (exc.stdout or '') if isinstance(exc.stdout, str) else (exc.stdout or b'').decode(errors='replace')
                code = 124
                timed = True
            Path(f'branch-{ordinal}.log').write_text(text)
            marked = [ansi.sub('', x) for x in text.splitlines() if marker in ansi.sub('', x)]
            entry = {
                'branch': parent + [harry_i],
                'outerReturnCode': code,
                'outerTimeout': timed,
                'markerCount': len(marked),
                'solver': None,
            }
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            if code != 0 or len(marked) != 1:
                failed = True
            out.append(entry)

    source_path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Harry binary exact branches failed')


def audit():
    source = json.loads(Path('harry-source/identity-334-harry-binary-exact-source.json').read_text())
    assert source['sourceBernardBinaryExactRunId'] == 37802187352
    assert source['sourceBernardBinaryExactArtifactId'] == 11574742299
    assert source['sourceBernardBinaryRoutingRunId'] == 37878996313
    assert source['sourceBernardBinaryRoutingAuditArtifactId'] == 11598948284
    assert source['sparseCustomer'] == 'harry'
    assert source['candidateGroups'] == HARRY_CHOICES
    assert source['subsets'] == HARRY_SUBSETS
    parents = source['parentBranches']
    assert len(parents) == 866
    expected = {tuple(parent + [split_i]) for parent in parents for split_i in (0, 1)}
    assert len(expected) == 1732

    results = {}
    duplicates = []
    malformed = []
    outer_failures = []
    outer_timeouts = []
    statuses = Counter()
    witnesses = []
    support_cuts = 0
    exact_infeasible_supports = 0
    fixed_support_attempts = 0
    exact_solve_ms = 0

    files = list(Path('exact-shards').rglob('exact-results.json'))
    if len(files) != 87:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 20:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 11 or any(v not in (0, 1) for v in branch[-4:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch})
                continue
            key = tuple(branch)
            if key in results:
                duplicates.append(branch)
                continue
            results[key] = entry
            if entry.get('outerReturnCode') != 0:
                outer_failures.append(entry)
            if entry.get('outerTimeout'):
                outer_timeouts.append(entry)
            solver = entry.get('solver')
            if not isinstance(solver, dict):
                malformed.append({'reason': 'missing-solver', 'branch': branch})
                continue
            if (
                solver.get('betsySplitIndex') != branch[-4]
                or solver.get('juliaSplitIndex') != branch[-3]
                or solver.get('bernardSplitIndex') != branch[-2]
                or solver.get('harrySplitIndex') != branch[-1]
                or solver.get('betsySubset') != BETSY_SUBSETS[branch[-4]]
                or solver.get('juliaSubset') != JULIA_SUBSETS[branch[-3]]
                or solver.get('bernardSubset') != BERNARD_SUBSETS[branch[-2]]
                or solver.get('harrySubset') != HARRY_SUBSETS[branch[-1]]
                or solver.get('sparseCustomer') != 'harry'
            ):
                malformed.append({'reason': 'solver-identity', 'branch': branch})
            status = solver.get('status')
            if not isinstance(status, str):
                malformed.append({'reason': 'solver-status', 'branch': branch})
                continue
            statuses[status] += 1
            support_cuts += int(solver.get('supportCuts', 0))
            exact_infeasible_supports += int(solver.get('exactInfeasibleSupports', 0))
            fixed_support_attempts += int(solver.get('fixedSupportExactAttempts', 0))
            exact_solve_ms += int(solver.get('exactSolveMs', 0))
            if status == 'global-witness':
                witnesses.append(branch)

    observed = set(results)
    branches_by_status = {}
    for key, entry in results.items():
        status = (entry.get('solver') or {}).get('status')
        if isinstance(status, str):
            branches_by_status.setdefault(status, []).append(list(key))
    for values in branches_by_status.values():
        values.sort()

    report = {
        'complete': expected == observed and not duplicates and not malformed and not outer_failures and not outer_timeouts,
        'sourceBernardBinaryExactRunId': 37802187352,
        'sourceBernardBinaryExactArtifactId': 11574742299,
        'sourceBernardBinaryRoutingRunId': 37878996313,
        'sourceBernardBinaryRoutingAuditArtifactId': 11598948284,
        'splitKind': 'required-any-used-binary',
        'sparseCustomer': 'harry',
        'harryCandidateGroups': HARRY_CHOICES,
        'harrySubsets': HARRY_SUBSETS,
        'expectedBranches': len(expected),
        'observedBranches': len(observed),
        'missingBranches': [list(x) for x in sorted(expected - observed)],
        'unexpectedBranches': [list(x) for x in sorted(observed - expected)],
        'duplicateBranches': duplicates,
        'malformed': malformed,
        'outerFailures': len(outer_failures),
        'outerTimeouts': len(outer_timeouts),
        'statuses': dict(sorted(statuses.items())),
        'branchesByStatus': branches_by_status,
        'exactInfeasibleBranches': statuses.get('infeasible', 0),
        'masterTimeoutBranches': statuses.get('timelimit', 0),
        'roundLimitBranches': statuses.get('round-limit', 0),
        'fixedSupportTimeoutBranches': statuses.get('exact-timelimit', 0),
        'supportCuts': support_cuts,
        'exactInfeasibleSupports': exact_infeasible_supports,
        'fixedSupportExactAttempts': fixed_support_attempts,
        'exactSolveMs': exact_solve_ms,
        'witnessCount': len(witnesses),
        'globalWitnessCount': len(witnesses),
        'witnesses': witnesses,
    }
    Path('identity-334-harry-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('[machine-extra1-pair-harry-binary-exact-audit]', json.dumps(report, separators=(',', ':')))
    if not report['complete']:
        raise SystemExit('Harry binary exact audit incomplete')


if __name__ == '__main__':
    {'prepare': prepare, 'run': run_shard, 'audit': audit}[sys.argv[1]]()
