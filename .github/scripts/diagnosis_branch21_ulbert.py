import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_martha as prev
import diagnosis_branch21_charles as base

BETSY_SUBSETS = prev.BETSY_SUBSETS
JULIA_SUBSETS = prev.JULIA_SUBSETS
BERNARD_SUBSETS = prev.BERNARD_SUBSETS
HARRY_SUBSETS = prev.HARRY_SUBSETS
CHARLES_SUBSETS = prev.CHARLES_SUBSETS
MARTHA_SUBSETS = prev.MARTHA_SUBSETS
ULBERT_CHOICES = [38,99,237,238,239,296,310,313,318,406,433,438,512,517,519,580,585,587,588,591,596,601,602,603,609,610,611,624,629,639,644,651,656,661,666,671]
ULBERT_SUBSETS = [ULBERT_CHOICES[:18], ULBERT_CHOICES[18:]]


def candidate_groups(routing):
    candidates = routing.get('candidates')
    assert isinstance(candidates, list)
    assert all(candidate.get('slackOnly') is False for candidate in candidates)
    return [candidate.get('groupIndex') for candidate in candidates]


def prepare():
    exact = json.loads(Path('martha-exact/identity-334-martha-binary-exact-audit.json').read_text())
    routing_audit = json.loads(Path('martha-routing/identity-334-martha-binary-routing-audit.json').read_text())
    assert exact['complete'] is True
    assert exact['expectedBranches'] == exact['observedBranches'] == 468
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 89, 'timelimit': 379}
    assert exact['exactInfeasibleBranches'] == 89
    assert exact['masterTimeoutBranches'] == 379
    assert exact['roundLimitBranches'] == 0
    assert exact['fixedSupportTimeoutBranches'] == 0
    assert exact['supportCuts'] == 0
    assert exact['exactInfeasibleSupports'] == 0
    assert exact['fixedSupportExactAttempts'] == 0
    assert exact['exactSolveMs'] == 0
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    assert exact['witnesses'] == []
    assert exact['parentBranchCount'] == 234
    assert exact['siblingFrotgaParentBranchCount'] == 1610
    residuals = exact['branchesByStatus']['timelimit']
    expected = {tuple(branch) for branch in residuals}
    assert len(residuals) == len(expected) == 379
    assert all(len(branch) == 13 and all(value in (0, 1) for value in branch[-6:]) for branch in residuals)

    assert routing_audit['complete'] is True
    assert routing_audit['sourceMarthaBinaryExactRunId'] == 37978236181
    assert routing_audit['sourceMarthaBinaryExactArtifactId'] == 11639564867
    assert routing_audit['expectedBranches'] == routing_audit['observedBranches'] == 379
    assert routing_audit['missingBranches'] == routing_audit['unexpectedBranches'] == routing_audit['duplicateBranches'] == routing_audit['malformed'] == []
    assert routing_audit['outerFailures'] == 0
    assert routing_audit['sparseCustomerCounts'] == {'ulbert': 379}
    assert routing_audit['exactClosedMarthaBranches'] == 89
    assert routing_audit['siblingFrotgaParentBranchCount'] == 1610
    assert sum(entry['branchCount'] for entry in routing_audit['routingSignatures']) == 379
    assert len(routing_audit['routingSignatures']) == 64
    for signature in routing_audit['routingSignatures']:
        assert signature['sparseCustomer'] == 'ulbert'
        assert [candidate['groupIndex'] for candidate in signature['candidates']] == ULBERT_CHOICES
        assert all(candidate['slackOnly'] is False for candidate in signature['candidates'])

    files = list(Path('martha-routing-shards').rglob('routing-results.json'))
    assert len(files) == 7
    observed = set()
    ulbert_parents = []
    for path in files:
        entries = json.loads(path.read_text())
        assert 1 <= len(entries) <= 60
        for entry in entries:
            branch = entry['branch']
            key = tuple(branch)
            assert len(branch) == 13 and all(value in (0, 1) for value in branch[-6:])
            assert key in expected and key not in observed
            assert entry['outerReturnCode'] == 0 and entry['outerTimeout'] is False and entry['markerCount'] == 1
            routing = entry['routing']
            assert routing['betsySplitIndex'] == branch[-6] and routing['betsySubset'] == BETSY_SUBSETS[branch[-6]]
            assert routing['juliaSplitIndex'] == branch[-5] and routing['juliaSubset'] == JULIA_SUBSETS[branch[-5]]
            assert routing['bernardSplitIndex'] == branch[-4] and routing['bernardSubset'] == BERNARD_SUBSETS[branch[-4]]
            assert routing['harrySplitIndex'] == branch[-3] and routing['harrySubset'] == HARRY_SUBSETS[branch[-3]]
            assert routing['charlesSplitIndex'] == branch[-2] and routing['charlesSubset'] == CHARLES_SUBSETS[branch[-2]]
            assert routing['marthaSplitIndex'] == branch[-1] and routing['marthaSubset'] == MARTHA_SUBSETS[branch[-1]]
            assert routing['sparseCustomer'] == 'ulbert'
            assert candidate_groups(routing) == ULBERT_CHOICES
            ulbert_parents.append(branch)
            observed.add(key)
    assert observed == expected
    assert len(ulbert_parents) == 379
    assert [len(part) for part in ULBERT_SUBSETS] == [18, 18]
    assert set(ULBERT_SUBSETS[0]).isdisjoint(ULBERT_SUBSETS[1])
    assert set(ULBERT_SUBSETS[0]) | set(ULBERT_SUBSETS[1]) == set(ULBERT_CHOICES)

    ulbert_parents.sort()
    source = {
        'sourceMarthaBinaryExactRunId': 37978236181,
        'sourceMarthaBinaryExactArtifactId': 11639564867,
        'sourceMarthaBinaryRoutingRunId': 37979747825,
        'sourceMarthaBinaryRoutingAuditArtifactId': 11641217137,
        'sparseCustomer': 'ulbert',
        'candidateGroups': ULBERT_CHOICES,
        'subsets': ULBERT_SUBSETS,
        'parentBranches': ulbert_parents,
        'exactClosedMarthaBranches': 89,
        'siblingFrotgaParentBranchCount': 1610,
    }
    Path('identity-334-ulbert-binary-exact-source.json').write_text(json.dumps(source, indent=2, sort_keys=True) + '\n')
    shards = [{'shard': i + 1, 'parents_json': json.dumps(ulbert_parents[start:start + 10], separators=(',', ':'))} for i, start in enumerate(range(0, len(ulbert_parents), 10))]
    assert len(shards) == 38
    assert sum(len(json.loads(shard['parents_json'])) for shard in shards) == 379
    assert sum(len(json.loads(shard['parents_json'])) * 2 for shard in shards) == 758
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = base.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 10
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-ulbert-binary-result] '
    out = []
    failed = False
    ordinal = 0
    for parent in parents:
        assert len(parent) == 13 and all(value in (0, 1) for value in parent[-6:])
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon, betsy_i, julia_i, bernard_i, harry_i, charles_i, martha_i = parent
        for ulbert_i, ulbert_subset in enumerate(ULBERT_SUBSETS):
            ordinal += 1
            b, j = BETSY_SUBSETS[betsy_i], JULIA_SUBSETS[julia_i]
            r, h = BERNARD_SUBSETS[bernard_i], HARRY_SUBSETS[harry_i]
            c, m = CHARLES_SUBSETS[charles_i], MARTHA_SUBSETS[martha_i]
            lines = [
                '',
                '    const fixedExactGroupIndex = 334',
                '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
                '    const fixedExactCustomers = [...fixedExactCustomerSet]',
                '    const requiredPair = [1052, 1070] as const',
                '    const saviusChoice = 692',
                '    const ambrosiaChoice = 1243',
                f'    const octaviusChoice = {octavius}', f'    const oliverChoice = {oliver}', f'    const hugoChoice = {hugo}',
                f'    const tiffanyChoice = {tiffany}', f'    const dominicChoice = {dominic}', f'    const heloiseChoice = {heloise}', f'    const solomonChoice = {solomon}',
                f'    const betsySplitIndex = {betsy_i}', f'    const betsySubset = {json.dumps(b,separators=(",",":"))} as const',
                f'    const juliaSplitIndex = {julia_i}', f'    const juliaSubset = {json.dumps(j,separators=(",",":"))} as const',
                f'    const bernardSplitIndex = {bernard_i}', f'    const bernardSubset = {json.dumps(r,separators=(",",":"))} as const',
                f'    const harrySplitIndex = {harry_i}', f'    const harrySubset = {json.dumps(h,separators=(",",":"))} as const',
                f'    const charlesSplitIndex = {charles_i}', f'    const charlesSubset = {json.dumps(c,separators=(",",":"))} as const',
                f'    const marthaSplitIndex = {martha_i}', f'    const marthaSubset = {json.dumps(m,separators=(",",":"))} as const',
                f'    const ulbertSplitIndex = {ulbert_i}', f'    const ulbertSubset = {json.dumps(ulbert_subset,separators=(",",":"))} as const',
                "    betsySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('betsy'))",
                "    juliaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('julia'))",
                "    bernardSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('bernard'))",
                "    harrySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('harry'))",
                "    charlesSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('charles'))",
                "    marthaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('martha'))",
                "    ulbertSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('ulbert'))",
                '    const thresholdCounts = [3, 1, 1, 0] as const', '    const supportCuts: number[][] = []', "    let status = 'round-limit'",
                '    let masterSolveMs = 0', '    let exactSolveMs = 0', '    let exactInfeasibleSupports = 0', '    let fixedSupportExactAttempts = 0',
                '    for (let round = 0; round < 16; round += 1) {',
                '      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, { supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice], requiredAnyUsedGroupIndexSets: [betsySubset, juliaSubset, bernardSubset, harrySubset, charlesSubset, marthaSubset, ulbertSubset], requiredExtraOneGroupIndexes: [...requiredPair] })',
                '      const solved = await solveBounded(built.model, 0.5)', '      masterSolveMs += solved.solveMs',
                "      if (solved.status === 'infeasible') { status = 'infeasible'; break }",
                "      if (solved.status !== 'optimal' || !solved.namedSolution) { status = solved.status; break }",
                "      const support = groups.flatMap((_group, groupIndex) => { const raw = solved.namedSolution!.get(`s31su_${groupIndex}`); return typeof raw === 'number' && Number.isFinite(raw) && raw > 0.5 ? [groupIndex] : [] })",
                "      if (support.length !== 30) throw new Error(`Expected 30 support groups, got ${support.length}`)",
                "      const exact = buildFinalizing30MaskPartitionStage(domain, new Set<ProductionStepKind>(['juicing', 'seasoning', 'blending']), thresholdCounts, { max: 76 }, 0, new Set(support))",
                '      fixedSupportExactAttempts += 1', '      const exactSolved = await solveBounded(exact.model, 3)', '      exactSolveMs += exactSolved.solveMs',
                "      if (exactSolved.status === 'infeasible') { exactInfeasibleSupports += 1; supportCuts.push(support); status = 'exact-infeasible-support'; continue }",
                "      if (exactSolved.status === 'optimal') { status = 'global-witness'; break }", "      status = `exact-${exactSolved.status}`", '      break', '    }',
                "    console.info('[machine-extra1-pair-ulbert-binary-result]', JSON.stringify({ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, betsySplitIndex, betsySubset, juliaSplitIndex, juliaSubset, bernardSplitIndex, bernardSubset, harrySplitIndex, harrySubset, charlesSplitIndex, charlesSubset, marthaSplitIndex, marthaSubset, sparseCustomer: 'ulbert', ulbertSplitIndex, ulbertSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }))",
            ]
            source_path.write_text(patched[:start] + base_test + '\n'.join(lines) + patched[end:])
            cmd = ['npx', 'vitest', 'run', str(source_path), '--maxWorkers=1', '--minWorkers=1', '-t', r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support']
            try:
                done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
                text, code, timed = done.stdout, done.returncode, False
            except subprocess.TimeoutExpired as exc:
                text = (exc.stdout or '') if isinstance(exc.stdout, str) else (exc.stdout or b'').decode(errors='replace')
                code, timed = 124, True
            Path(f'branch-{ordinal}.log').write_text(text)
            marked = [ansi.sub('', line) for line in text.splitlines() if marker in ansi.sub('', line)]
            entry = {'branch': parent + [ulbert_i], 'outerReturnCode': code, 'outerTimeout': timed, 'markerCount': len(marked), 'solver': None}
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            failed |= code != 0 or len(marked) != 1
            out.append(entry)
    source_path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Ulbert binary exact branches failed')


def audit():
    source = json.loads(Path('ulbert-source/identity-334-ulbert-binary-exact-source.json').read_text())
    assert source['sourceMarthaBinaryExactRunId'] == 37978236181
    assert source['sourceMarthaBinaryExactArtifactId'] == 11639564867
    assert source['sourceMarthaBinaryRoutingRunId'] == 37979747825
    assert source['sourceMarthaBinaryRoutingAuditArtifactId'] == 11641217137
    assert source['sparseCustomer'] == 'ulbert' and source['candidateGroups'] == ULBERT_CHOICES and source['subsets'] == ULBERT_SUBSETS
    assert source['exactClosedMarthaBranches'] == 89
    assert source['siblingFrotgaParentBranchCount'] == 1610
    parents = source['parentBranches']
    assert len(parents) == len({tuple(parent) for parent in parents}) == 379
    expected = {tuple(parent + [split_i]) for parent in parents for split_i in (0, 1)}
    assert len(expected) == 758
    results, duplicates, malformed, outer_failures, outer_timeouts = {}, [], [], [], []
    statuses, witnesses = Counter(), []
    support_cuts = exact_infeasible_supports = fixed_support_attempts = exact_solve_ms = 0
    files = list(Path('exact-shards').rglob('exact-results.json'))
    if len(files) != 38:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 20:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 14 or any(value not in (0, 1) for value in branch[-7:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch}); continue
            key = tuple(branch)
            if key in results:
                duplicates.append(branch); continue
            results[key] = entry
            if entry.get('outerReturnCode') != 0: outer_failures.append(entry)
            if entry.get('outerTimeout'): outer_timeouts.append(entry)
            solver = entry.get('solver')
            if not isinstance(solver, dict):
                malformed.append({'reason': 'missing-solver', 'branch': branch}); continue
            identity_ok = (
                solver.get('betsySplitIndex') == branch[-7] and solver.get('betsySubset') == BETSY_SUBSETS[branch[-7]] and
                solver.get('juliaSplitIndex') == branch[-6] and solver.get('juliaSubset') == JULIA_SUBSETS[branch[-6]] and
                solver.get('bernardSplitIndex') == branch[-5] and solver.get('bernardSubset') == BERNARD_SUBSETS[branch[-5]] and
                solver.get('harrySplitIndex') == branch[-4] and solver.get('harrySubset') == HARRY_SUBSETS[branch[-4]] and
                solver.get('charlesSplitIndex') == branch[-3] and solver.get('charlesSubset') == CHARLES_SUBSETS[branch[-3]] and
                solver.get('marthaSplitIndex') == branch[-2] and solver.get('marthaSubset') == MARTHA_SUBSETS[branch[-2]] and
                solver.get('ulbertSplitIndex') == branch[-1] and solver.get('ulbertSubset') == ULBERT_SUBSETS[branch[-1]] and solver.get('sparseCustomer') == 'ulbert'
            )
            if not identity_ok: malformed.append({'reason': 'solver-identity', 'branch': branch})
            status = solver.get('status')
            if not isinstance(status, str): malformed.append({'reason': 'solver-status', 'branch': branch}); continue
            statuses[status] += 1
            support_cuts += int(solver.get('supportCuts', 0)); exact_infeasible_supports += int(solver.get('exactInfeasibleSupports', 0))
            fixed_support_attempts += int(solver.get('fixedSupportExactAttempts', 0)); exact_solve_ms += int(solver.get('exactSolveMs', 0))
            if status == 'global-witness': witnesses.append(branch)
    observed = set(results)
    branches_by_status = {}
    for key, entry in results.items():
        status = (entry.get('solver') or {}).get('status')
        if isinstance(status, str): branches_by_status.setdefault(status, []).append(list(key))
    for values in branches_by_status.values(): values.sort()
    report = {
        'complete': expected == observed and not duplicates and not malformed and not outer_failures and not outer_timeouts,
        'sourceMarthaBinaryExactRunId': 37978236181, 'sourceMarthaBinaryExactArtifactId': 11639564867,
        'sourceMarthaBinaryRoutingRunId': 37979747825, 'sourceMarthaBinaryRoutingAuditArtifactId': 11641217137,
        'splitKind': 'required-any-used-binary', 'sparseCustomer': 'ulbert', 'ulbertCandidateGroups': ULBERT_CHOICES, 'ulbertSubsets': ULBERT_SUBSETS,
        'parentBranchCount': 379, 'exactClosedMarthaBranches': 89, 'siblingFrotgaParentBranchCount': 1610,
        'expectedBranches': len(expected), 'observedBranches': len(observed),
        'missingBranches': [list(branch) for branch in sorted(expected - observed)], 'unexpectedBranches': [list(branch) for branch in sorted(observed - expected)],
        'duplicateBranches': duplicates, 'malformed': malformed, 'outerFailures': len(outer_failures), 'outerTimeouts': len(outer_timeouts),
        'statuses': dict(sorted(statuses.items())), 'branchesByStatus': branches_by_status,
        'exactInfeasibleBranches': statuses.get('infeasible', 0), 'masterTimeoutBranches': statuses.get('timelimit', 0),
        'roundLimitBranches': statuses.get('round-limit', 0), 'fixedSupportTimeoutBranches': statuses.get('exact-timelimit', 0),
        'supportCuts': support_cuts, 'exactInfeasibleSupports': exact_infeasible_supports, 'fixedSupportExactAttempts': fixed_support_attempts,
        'exactSolveMs': exact_solve_ms, 'witnessCount': len(witnesses), 'globalWitnessCount': len(witnesses), 'witnesses': witnesses,
    }
    Path('identity-334-ulbert-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('[machine-extra1-pair-ulbert-binary-exact-audit]', json.dumps(report, separators=(',', ':')))
    if not report['complete']:
        raise SystemExit('Ulbert binary exact audit incomplete')


if __name__ == '__main__':
    {'prepare': prepare, 'run': run_shard, 'audit': audit}[sys.argv[1]]()
