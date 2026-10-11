import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_charles as prev

BETSY_SUBSETS = prev.BETSY_SUBSETS
JULIA_SUBSETS = prev.JULIA_SUBSETS
BERNARD_SUBSETS = prev.BERNARD_SUBSETS
HARRY_SUBSETS = prev.HARRY_SUBSETS
CHARLES_SUBSETS = prev.CHARLES_SUBSETS
FROTGA_CHOICES = [289,638,749,750,810,811,812,813,814,815,845,850,858,859,860,861,1035,1036,1138,1141,1182,1183,1199,1203,1204,1368,1392,1395,1396,1399]
FROTGA_SUBSETS = [FROTGA_CHOICES[:15], FROTGA_CHOICES[15:]]
MARTHA_CHOICES = [16,25,208,210,228,585,588,700,776,884,886,923,925,962,965,979,992,994,1004,1010,1012,1017,1163,1165,1176,1274,1315,1318,1329,1334,1362,1387,1406,1407,1408,1409]


def candidate_groups(routing):
    candidates = routing.get('candidates')
    assert isinstance(candidates, list)
    assert all(candidate.get('slackOnly') is False for candidate in candidates)
    return [candidate.get('groupIndex') for candidate in candidates]


def prepare():
    exact = json.loads(Path('charles-exact/identity-334-charles-binary-exact-audit.json').read_text())
    routing_audit = json.loads(Path('charles-routing/identity-334-charles-binary-routing-audit.json').read_text())
    assert exact['complete'] is True
    assert exact['expectedBranches'] == exact['observedBranches'] == 2584
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 740, 'timelimit': 1844}
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    assert exact['witnesses'] == []
    residuals = exact['branchesByStatus']['timelimit']
    expected = {tuple(branch) for branch in residuals}
    assert len(residuals) == len(expected) == 1844
    assert all(len(branch) == 12 and all(value in (0, 1) for value in branch[-5:]) for branch in residuals)

    assert routing_audit['complete'] is True
    assert routing_audit['sourceCharlesBinaryExactRunId'] == 37919338979
    assert routing_audit['sourceCharlesBinaryExactArtifactId'] == 11611858688
    assert routing_audit['expectedBranches'] == routing_audit['observedBranches'] == 1844
    assert routing_audit['missingBranches'] == routing_audit['unexpectedBranches'] == routing_audit['duplicateBranches'] == routing_audit['malformed'] == []
    assert routing_audit['outerFailures'] == 0
    assert routing_audit['sparseCustomerCounts'] == {'frotga': 1610, 'martha': 234}
    assert sum(entry['branchCount'] for entry in routing_audit['routingSignatures']) == 1844
    for signature in routing_audit['routingSignatures']:
        assert all(candidate['slackOnly'] is False for candidate in signature['candidates'])
        groups = [candidate['groupIndex'] for candidate in signature['candidates']]
        if signature['sparseCustomer'] == 'frotga':
            assert groups == FROTGA_CHOICES
        else:
            assert signature['sparseCustomer'] == 'martha' and groups == MARTHA_CHOICES

    files = list(Path('charles-routing-shards').rglob('routing-results.json'))
    assert len(files) == 31
    observed = set()
    frotga_parents = []
    martha_count = 0
    for path in files:
        entries = json.loads(path.read_text())
        assert 1 <= len(entries) <= 60
        for entry in entries:
            branch = entry['branch']
            key = tuple(branch)
            assert len(branch) == 12 and all(value in (0, 1) for value in branch[-5:])
            assert key in expected and key not in observed
            assert entry['outerReturnCode'] == 0 and entry['outerTimeout'] is False and entry['markerCount'] == 1
            routing = entry['routing']
            assert routing['betsySplitIndex'] == branch[-5] and routing['betsySubset'] == BETSY_SUBSETS[branch[-5]]
            assert routing['juliaSplitIndex'] == branch[-4] and routing['juliaSubset'] == JULIA_SUBSETS[branch[-4]]
            assert routing['bernardSplitIndex'] == branch[-3] and routing['bernardSubset'] == BERNARD_SUBSETS[branch[-3]]
            assert routing['harrySplitIndex'] == branch[-2] and routing['harrySubset'] == HARRY_SUBSETS[branch[-2]]
            assert routing['charlesSplitIndex'] == branch[-1] and routing['charlesSubset'] == CHARLES_SUBSETS[branch[-1]]
            if routing['sparseCustomer'] == 'frotga':
                assert candidate_groups(routing) == FROTGA_CHOICES
                frotga_parents.append(branch)
            else:
                assert routing['sparseCustomer'] == 'martha' and candidate_groups(routing) == MARTHA_CHOICES
                martha_count += 1
            observed.add(key)
    assert observed == expected
    assert len(frotga_parents) == 1610 and martha_count == 234
    assert [len(part) for part in FROTGA_SUBSETS] == [15, 15]
    assert set(FROTGA_SUBSETS[0]).isdisjoint(FROTGA_SUBSETS[1])
    assert set(FROTGA_SUBSETS[0]) | set(FROTGA_SUBSETS[1]) == set(FROTGA_CHOICES)

    frotga_parents.sort()
    source = {
        'sourceCharlesBinaryExactRunId': 37919338979,
        'sourceCharlesBinaryExactArtifactId': 11611858688,
        'sourceCharlesBinaryRoutingRunId': 37922329738,
        'sourceCharlesBinaryRoutingAuditArtifactId': 11612948479,
        'sparseCustomer': 'frotga',
        'candidateGroups': FROTGA_CHOICES,
        'subsets': FROTGA_SUBSETS,
        'parentBranches': frotga_parents,
        'untouchedMarthaParentBranchCount': martha_count,
    }
    Path('identity-334-frotga-binary-exact-source.json').write_text(json.dumps(source, indent=2, sort_keys=True) + '\n')
    shards = [{'shard': i + 1, 'parents_json': json.dumps(frotga_parents[start:start + 10], separators=(',', ':'))} for i, start in enumerate(range(0, len(frotga_parents), 10))]
    assert len(shards) == 161
    assert sum(len(json.loads(shard['parents_json'])) for shard in shards) == 1610
    assert sum(len(json.loads(shard['parents_json'])) * 2 for shard in shards) == 3220
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = prev.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 10
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-frotga-binary-result] '
    out = []
    failed = False
    ordinal = 0
    for parent in parents:
        assert len(parent) == 12 and all(value in (0, 1) for value in parent[-5:])
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon, betsy_i, julia_i, bernard_i, harry_i, charles_i = parent
        for frotga_i, frotga_subset in enumerate(FROTGA_SUBSETS):
            ordinal += 1
            b, j = BETSY_SUBSETS[betsy_i], JULIA_SUBSETS[julia_i]
            r, h = BERNARD_SUBSETS[bernard_i], HARRY_SUBSETS[harry_i]
            c = CHARLES_SUBSETS[charles_i]
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
                f'    const frotgaSplitIndex = {frotga_i}', f'    const frotgaSubset = {json.dumps(frotga_subset,separators=(",",":"))} as const',
                "    betsySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('betsy'))",
                "    juliaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('julia'))",
                "    bernardSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('bernard'))",
                "    harrySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('harry'))",
                "    charlesSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('charles'))",
                "    frotgaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('frotga'))",
                '    const thresholdCounts = [3, 1, 1, 0] as const', '    const supportCuts: number[][] = []', "    let status = 'round-limit'",
                '    let masterSolveMs = 0', '    let exactSolveMs = 0', '    let exactInfeasibleSupports = 0', '    let fixedSupportExactAttempts = 0',
                '    for (let round = 0; round < 16; round += 1) {',
                '      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, { supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice], requiredAnyUsedGroupIndexSets: [betsySubset, juliaSubset, bernardSubset, harrySubset, charlesSubset, frotgaSubset], requiredExtraOneGroupIndexes: [...requiredPair] })',
                '      const solved = await solveBounded(built.model, 0.5)', '      masterSolveMs += solved.solveMs',
                "      if (solved.status === 'infeasible') { status = 'infeasible'; break }",
                "      if (solved.status !== 'optimal' || !solved.namedSolution) { status = solved.status; break }",
                "      const support = groups.flatMap((_group, groupIndex) => { const raw = solved.namedSolution!.get(`s31su_${groupIndex}`); return typeof raw === 'number' && Number.isFinite(raw) && raw > 0.5 ? [groupIndex] : [] })",
                "      if (support.length !== 30) throw new Error(`Expected 30 support groups, got ${support.length}`)",
                "      const exact = buildFinalizing30MaskPartitionStage(domain, new Set<ProductionStepKind>(['juicing', 'seasoning', 'blending']), thresholdCounts, { max: 76 }, 0, new Set(support))",
                '      fixedSupportExactAttempts += 1', '      const exactSolved = await solveBounded(exact.model, 3)', '      exactSolveMs += exactSolved.solveMs',
                "      if (exactSolved.status === 'infeasible') { exactInfeasibleSupports += 1; supportCuts.push(support); status = 'exact-infeasible-support'; continue }",
                "      if (exactSolved.status === 'optimal') { status = 'global-witness'; break }", "      status = `exact-${exactSolved.status}`", '      break', '    }',
                "    console.info('[machine-extra1-pair-frotga-binary-result]', JSON.stringify({ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, betsySplitIndex, betsySubset, juliaSplitIndex, juliaSubset, bernardSplitIndex, bernardSubset, harrySplitIndex, harrySubset, charlesSplitIndex, charlesSubset, sparseCustomer: 'frotga', frotgaSplitIndex, frotgaSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }))",
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
            entry = {'branch': parent + [frotga_i], 'outerReturnCode': code, 'outerTimeout': timed, 'markerCount': len(marked), 'solver': None}
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            failed |= code != 0 or len(marked) != 1
            out.append(entry)
    source_path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Frotga binary exact branches failed')


def audit():
    source = json.loads(Path('frotga-source/identity-334-frotga-binary-exact-source.json').read_text())
    assert source['sourceCharlesBinaryExactRunId'] == 37919338979
    assert source['sourceCharlesBinaryExactArtifactId'] == 11611858688
    assert source['sourceCharlesBinaryRoutingRunId'] == 37922329738
    assert source['sourceCharlesBinaryRoutingAuditArtifactId'] == 11612948479
    assert source['sparseCustomer'] == 'frotga' and source['candidateGroups'] == FROTGA_CHOICES and source['subsets'] == FROTGA_SUBSETS
    assert source['untouchedMarthaParentBranchCount'] == 234
    parents = source['parentBranches']
    assert len(parents) == len({tuple(parent) for parent in parents}) == 1610
    expected = {tuple(parent + [split_i]) for parent in parents for split_i in (0, 1)}
    assert len(expected) == 3220
    results, duplicates, malformed, outer_failures, outer_timeouts = {}, [], [], [], []
    statuses, witnesses = Counter(), []
    support_cuts = exact_infeasible_supports = fixed_support_attempts = exact_solve_ms = 0
    files = list(Path('exact-shards').rglob('exact-results.json'))
    if len(files) != 161:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 20:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 13 or any(value not in (0, 1) for value in branch[-6:]):
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
                solver.get('betsySplitIndex') == branch[-6] and solver.get('betsySubset') == BETSY_SUBSETS[branch[-6]] and
                solver.get('juliaSplitIndex') == branch[-5] and solver.get('juliaSubset') == JULIA_SUBSETS[branch[-5]] and
                solver.get('bernardSplitIndex') == branch[-4] and solver.get('bernardSubset') == BERNARD_SUBSETS[branch[-4]] and
                solver.get('harrySplitIndex') == branch[-3] and solver.get('harrySubset') == HARRY_SUBSETS[branch[-3]] and
                solver.get('charlesSplitIndex') == branch[-2] and solver.get('charlesSubset') == CHARLES_SUBSETS[branch[-2]] and
                solver.get('frotgaSplitIndex') == branch[-1] and solver.get('frotgaSubset') == FROTGA_SUBSETS[branch[-1]] and solver.get('sparseCustomer') == 'frotga'
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
        'sourceCharlesBinaryExactRunId': 37919338979, 'sourceCharlesBinaryExactArtifactId': 11611858688,
        'sourceCharlesBinaryRoutingRunId': 37922329738, 'sourceCharlesBinaryRoutingAuditArtifactId': 11612948479,
        'splitKind': 'required-any-used-binary', 'sparseCustomer': 'frotga', 'frotgaCandidateGroups': FROTGA_CHOICES, 'frotgaSubsets': FROTGA_SUBSETS,
        'parentBranchCount': 1610, 'untouchedMarthaParentBranchCount': 234, 'expectedBranches': len(expected), 'observedBranches': len(observed),
        'missingBranches': [list(branch) for branch in sorted(expected - observed)], 'unexpectedBranches': [list(branch) for branch in sorted(observed - expected)],
        'duplicateBranches': duplicates, 'malformed': malformed, 'outerFailures': len(outer_failures), 'outerTimeouts': len(outer_timeouts),
        'statuses': dict(sorted(statuses.items())), 'branchesByStatus': branches_by_status,
        'exactInfeasibleBranches': statuses.get('infeasible', 0), 'masterTimeoutBranches': statuses.get('timelimit', 0),
        'roundLimitBranches': statuses.get('round-limit', 0), 'fixedSupportTimeoutBranches': statuses.get('exact-timelimit', 0),
        'supportCuts': support_cuts, 'exactInfeasibleSupports': exact_infeasible_supports, 'fixedSupportExactAttempts': fixed_support_attempts,
        'exactSolveMs': exact_solve_ms, 'witnessCount': len(witnesses), 'globalWitnessCount': len(witnesses), 'witnesses': witnesses,
    }
    Path('identity-334-frotga-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('[machine-extra1-pair-frotga-binary-exact-audit]', json.dumps(report, separators=(',', ':')))
    if not report['complete']:
        raise SystemExit('Frotga binary exact audit incomplete')


if __name__ == '__main__':
    {'prepare': prepare, 'run': run_shard, 'audit': audit}[sys.argv[1]]()
