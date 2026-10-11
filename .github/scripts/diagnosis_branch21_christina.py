import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_charles as base
import diagnosis_branch21_tacy as prev

BETSY_SUBSETS = prev.BETSY_SUBSETS
JULIA_SUBSETS = prev.JULIA_SUBSETS
BERNARD_SUBSETS = prev.BERNARD_SUBSETS
HARRY_SUBSETS = prev.HARRY_SUBSETS
CHARLES_SUBSETS = prev.CHARLES_SUBSETS
MARTHA_SUBSETS = prev.MARTHA_SUBSETS
ULBERT_SUBSETS = prev.ULBERT_SUBSETS
TACY_SUBSETS = prev.TACY_SUBSETS
CHRISTINA_CHOICES = [95, 96, 149, 151, 154, 225, 231, 232, 233, 311, 317, 319, 320, 323, 324, 397, 398, 764, 869, 871, 912, 914, 950, 952, 953, 967, 982, 984, 986, 989, 992, 994, 996, 1006, 1014, 1017, 1223, 1255, 1257, 1259, 1260, 1265, 1269, 1274, 1279, 1281]
CHRISTINA_SUBSETS = [CHRISTINA_CHOICES[:23], CHRISTINA_CHOICES[23:]]


def candidate_groups(routing):
    candidates = routing.get('candidates')
    assert isinstance(candidates, list)
    assert all(candidate.get('slackOnly') is False for candidate in candidates)
    return [candidate.get('groupIndex') for candidate in candidates]


def prepare():
    exact = json.loads(Path('tacy-exact/identity-334-tacy-binary-exact-audit.json').read_text())
    routing_audit = json.loads(Path('tacy-routing/identity-334-tacy-binary-routing-audit.json').read_text())
    assert exact['complete'] is True
    assert exact['sourceUlbertBinaryExactRunId'] == 37981623236
    assert exact['sourceUlbertBinaryExactArtifactId'] == 11642000936
    assert exact['sourceUlbertBinaryRoutingRunId'] == 37983086127
    assert exact['sourceUlbertBinaryRoutingAuditArtifactId'] == 11641553480
    assert exact['splitKind'] == 'required-any-used-binary'
    assert exact['sparseCustomer'] == 'tacy'
    assert exact['tacyCandidateGroups'] == prev.TACY_CHOICES
    assert exact['tacySubsets'] == TACY_SUBSETS
    assert exact['expectedBranches'] == exact['observedBranches'] == 1204
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 234, 'timelimit': 970}
    assert exact['exactInfeasibleBranches'] == 234
    assert exact['masterTimeoutBranches'] == 970
    assert exact['roundLimitBranches'] == 0
    assert exact['fixedSupportTimeoutBranches'] == 0
    assert exact['supportCuts'] == 0
    assert exact['exactInfeasibleSupports'] == 0
    assert exact['fixedSupportExactAttempts'] == 0
    assert exact['exactSolveMs'] == 0
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    assert exact['witnesses'] == []
    assert exact['parentBranchCount'] == 602
    assert exact['exactClosedUlbertBranches'] == 156
    assert exact['exactClosedMarthaBranches'] == 89
    assert exact['siblingFrotgaParentBranchCount'] == 1610
    residuals = exact['branchesByStatus']['timelimit']
    expected = {tuple(branch) for branch in residuals}
    assert len(residuals) == len(expected) == 970
    assert all(len(branch) == 15 and all(value in (0, 1) for value in branch[-8:]) for branch in residuals)

    assert routing_audit['complete'] is True
    assert routing_audit['sourceTacyBinaryExactRunId'] == 37984707367
    assert routing_audit['sourceTacyBinaryExactArtifactId'] == 11643631020
    assert routing_audit['expectedBranches'] == routing_audit['observedBranches'] == 970
    assert routing_audit['missingBranches'] == routing_audit['unexpectedBranches'] == routing_audit['duplicateBranches'] == routing_audit['malformed'] == []
    assert routing_audit['outerFailures'] == 0
    assert routing_audit['sparseCustomerCounts'] == {'christina': 970}
    assert routing_audit['exactClosedTacyBranches'] == 234
    assert routing_audit['exactClosedUlbertBranches'] == 156
    assert routing_audit['exactClosedMarthaBranches'] == 89
    assert routing_audit['siblingFrotgaParentBranchCount'] == 1610
    assert sum(entry['branchCount'] for entry in routing_audit['routingSignatures']) == 970
    assert len(routing_audit['routingSignatures']) == 256
    for signature in routing_audit['routingSignatures']:
        assert signature['sparseCustomer'] == 'christina'
        assert [candidate['groupIndex'] for candidate in signature['candidates']] == CHRISTINA_CHOICES
        assert all(candidate['slackOnly'] is False for candidate in signature['candidates'])

    files = list(Path('tacy-routing-shards').rglob('routing-results.json'))
    assert len(files) == 17
    observed = set()
    christina_parents = []
    for path in files:
        entries = json.loads(path.read_text())
        assert 1 <= len(entries) <= 60
        for entry in entries:
            branch = entry['branch']
            key = tuple(branch)
            assert len(branch) == 15 and all(value in (0, 1) for value in branch[-8:])
            assert key in expected and key not in observed
            assert entry['outerReturnCode'] == 0 and entry['outerTimeout'] is False and entry['markerCount'] == 1
            routing = entry['routing']
            assert routing['betsySplitIndex'] == branch[-8] and routing['betsySubset'] == BETSY_SUBSETS[branch[-8]]
            assert routing['juliaSplitIndex'] == branch[-7] and routing['juliaSubset'] == JULIA_SUBSETS[branch[-7]]
            assert routing['bernardSplitIndex'] == branch[-6] and routing['bernardSubset'] == BERNARD_SUBSETS[branch[-6]]
            assert routing['harrySplitIndex'] == branch[-5] and routing['harrySubset'] == HARRY_SUBSETS[branch[-5]]
            assert routing['charlesSplitIndex'] == branch[-4] and routing['charlesSubset'] == CHARLES_SUBSETS[branch[-4]]
            assert routing['marthaSplitIndex'] == branch[-3] and routing['marthaSubset'] == MARTHA_SUBSETS[branch[-3]]
            assert routing['ulbertSplitIndex'] == branch[-2] and routing['ulbertSubset'] == ULBERT_SUBSETS[branch[-2]]
            assert routing['tacySplitIndex'] == branch[-1] and routing['tacySubset'] == TACY_SUBSETS[branch[-1]]
            assert routing['sparseCustomer'] == 'christina'
            assert candidate_groups(routing) == CHRISTINA_CHOICES
            christina_parents.append(branch)
            observed.add(key)
    assert observed == expected
    assert len(christina_parents) == 970
    assert [len(part) for part in CHRISTINA_SUBSETS] == [23, 23]
    assert set(CHRISTINA_SUBSETS[0]).isdisjoint(CHRISTINA_SUBSETS[1])
    assert set(CHRISTINA_SUBSETS[0]) | set(CHRISTINA_SUBSETS[1]) == set(CHRISTINA_CHOICES)

    christina_parents.sort()
    source = {
        'sourceTacyBinaryExactRunId': 37984707367,
        'sourceTacyBinaryExactArtifactId': 11643631020,
        'sourceTacyBinaryRoutingRunId': 38014113202,
        'sourceTacyBinaryRoutingAuditArtifactId': 11654409147,
        'sparseCustomer': 'christina',
        'candidateGroups': CHRISTINA_CHOICES,
        'subsets': CHRISTINA_SUBSETS,
        'parentBranches': christina_parents,
        'exactClosedTacyBranches': 234,
        'exactClosedUlbertBranches': 156,
        'exactClosedMarthaBranches': 89,
        'siblingFrotgaParentBranchCount': 1610,
    }
    Path('identity-334-christina-binary-exact-source.json').write_text(json.dumps(source, indent=2, sort_keys=True) + '\n')
    shards = [
        {'shard': i + 1, 'parents_json': json.dumps(christina_parents[start:start + 10], separators=(',', ':'))}
        for i, start in enumerate(range(0, len(christina_parents), 10))
    ]
    assert len(shards) == 97
    assert sum(len(json.loads(shard['parents_json'])) for shard in shards) == 970
    assert sum(len(json.loads(shard['parents_json'])) * 2 for shard in shards) == 1940
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = base.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 10
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-christina-binary-result] '
    out = []
    failed = False
    ordinal = 0
    for parent in parents:
        assert len(parent) == 15 and all(value in (0, 1) for value in parent[-8:])
        (
            octavius, oliver, hugo, tiffany, dominic, heloise, solomon,
            betsy_i, julia_i, bernard_i, harry_i, charles_i, martha_i, ulbert_i, tacy_i,
        ) = parent
        for christina_i, christina_subset in enumerate(CHRISTINA_SUBSETS):
            ordinal += 1
            b, j = BETSY_SUBSETS[betsy_i], JULIA_SUBSETS[julia_i]
            r, h = BERNARD_SUBSETS[bernard_i], HARRY_SUBSETS[harry_i]
            c, m = CHARLES_SUBSETS[charles_i], MARTHA_SUBSETS[martha_i]
            u, t = ULBERT_SUBSETS[ulbert_i], TACY_SUBSETS[tacy_i]
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
                f'    const ulbertSplitIndex = {ulbert_i}', f'    const ulbertSubset = {json.dumps(u,separators=(",",":"))} as const',
                f'    const tacySplitIndex = {tacy_i}', f'    const tacySubset = {json.dumps(t,separators=(",",":"))} as const',
                f'    const christinaSplitIndex = {christina_i}', f'    const christinaSubset = {json.dumps(christina_subset,separators=(",",":"))} as const',
                "    betsySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('betsy'))",
                "    juliaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('julia'))",
                "    bernardSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('bernard'))",
                "    harrySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('harry'))",
                "    charlesSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('charles'))",
                "    marthaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('martha'))",
                "    ulbertSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('ulbert'))",
                "    tacySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('tacy'))",
                "    christinaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('christina'))",
                '    const thresholdCounts = [3, 1, 1, 0] as const',
                '    const supportCuts: number[][] = []',
                "    let status = 'round-limit'",
                '    let masterSolveMs = 0',
                '    let exactSolveMs = 0',
                '    let exactInfeasibleSupports = 0',
                '    let fixedSupportExactAttempts = 0',
                '    for (let round = 0; round < 16; round += 1) {',
                '      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, { supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice], requiredAnyUsedGroupIndexSets: [betsySubset, juliaSubset, bernardSubset, harrySubset, charlesSubset, marthaSubset, ulbertSubset, tacySubset, christinaSubset], requiredExtraOneGroupIndexes: [...requiredPair] })',
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
                "    console.info('[machine-extra1-pair-christina-binary-result]', JSON.stringify({ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, betsySplitIndex, betsySubset, juliaSplitIndex, juliaSubset, bernardSplitIndex, bernardSubset, harrySplitIndex, harrySubset, charlesSplitIndex, charlesSubset, marthaSplitIndex, marthaSubset, ulbertSplitIndex, ulbertSubset, tacySplitIndex, tacySubset, sparseCustomer: 'christina', christinaSplitIndex, christinaSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }))",
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
            entry = {'branch': parent + [christina_i], 'outerReturnCode': code, 'outerTimeout': timed, 'markerCount': len(marked), 'solver': None}
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            failed |= code != 0 or len(marked) != 1
            out.append(entry)
    source_path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Christina binary exact branches failed')


def audit():
    source = json.loads(Path('christina-source/identity-334-christina-binary-exact-source.json').read_text())
    assert source['sourceTacyBinaryExactRunId'] == 37984707367
    assert source['sourceTacyBinaryExactArtifactId'] == 11643631020
    assert source['sourceTacyBinaryRoutingRunId'] == 38014113202
    assert source['sourceTacyBinaryRoutingAuditArtifactId'] == 11654409147
    assert source['sparseCustomer'] == 'christina'
    assert source['candidateGroups'] == CHRISTINA_CHOICES
    assert source['subsets'] == CHRISTINA_SUBSETS
    assert source['exactClosedTacyBranches'] == 234
    assert source['exactClosedUlbertBranches'] == 156
    assert source['exactClosedMarthaBranches'] == 89
    assert source['siblingFrotgaParentBranchCount'] == 1610
    parents = source['parentBranches']
    assert len(parents) == 970
    assert len({tuple(parent) for parent in parents}) == 970
    assert all(len(parent) == 15 and all(value in (0, 1) for value in parent[-8:]) for parent in parents)
    expected = {tuple(parent + [split]) for parent in parents for split in (0, 1)}
    assert len(expected) == 1940

    files = list(Path('exact-shards').rglob('exact-results.json'))
    results = {}
    duplicates = []
    malformed = []
    outer_failures = 0
    outer_timeouts = 0
    statuses = Counter()
    support_cuts = 0
    exact_infeasible_supports = 0
    fixed_support_attempts = 0
    exact_solve_ms = 0
    witnesses = []
    branches_by_status = {}
    if len(files) != 97:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 20:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 16 or any(value not in (0, 1) for value in branch[-9:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch})
                continue
            key = tuple(branch)
            if key in results:
                duplicates.append(branch)
                continue
            results[key] = entry
            if entry.get('outerReturnCode') != 0:
                outer_failures += 1
            if entry.get('outerTimeout'):
                outer_timeouts += 1
            solver = entry.get('solver')
            if not isinstance(solver, dict):
                malformed.append({'reason': 'missing-solver', 'branch': branch})
                continue
            if (
                solver.get('betsySplitIndex') != branch[-9]
                or solver.get('juliaSplitIndex') != branch[-8]
                or solver.get('bernardSplitIndex') != branch[-7]
                or solver.get('harrySplitIndex') != branch[-6]
                or solver.get('charlesSplitIndex') != branch[-5]
                or solver.get('marthaSplitIndex') != branch[-4]
                or solver.get('ulbertSplitIndex') != branch[-3]
                or solver.get('tacySplitIndex') != branch[-2]
                or solver.get('christinaSplitIndex') != branch[-1]
                or solver.get('betsySubset') != BETSY_SUBSETS[branch[-9]]
                or solver.get('juliaSubset') != JULIA_SUBSETS[branch[-8]]
                or solver.get('bernardSubset') != BERNARD_SUBSETS[branch[-7]]
                or solver.get('harrySubset') != HARRY_SUBSETS[branch[-6]]
                or solver.get('charlesSubset') != CHARLES_SUBSETS[branch[-5]]
                or solver.get('marthaSubset') != MARTHA_SUBSETS[branch[-4]]
                or solver.get('ulbertSubset') != ULBERT_SUBSETS[branch[-3]]
                or solver.get('tacySubset') != TACY_SUBSETS[branch[-2]]
                or solver.get('christinaSubset') != CHRISTINA_SUBSETS[branch[-1]]
                or solver.get('sparseCustomer') != 'christina'
            ):
                malformed.append({'reason': 'solver-identity', 'branch': branch})
            status = solver.get('status')
            if not isinstance(status, str):
                malformed.append({'reason': 'solver-status', 'branch': branch})
                continue
            statuses[status] += 1
            branches_by_status.setdefault(status, []).append(branch)
            support_cuts += int(solver.get('supportCuts') or 0)
            exact_infeasible_supports += int(solver.get('exactInfeasibleSupports') or 0)
            fixed_support_attempts += int(solver.get('fixedSupportExactAttempts') or 0)
            exact_solve_ms += int(solver.get('exactSolveMs') or 0)
            if status == 'global-witness':
                witnesses.append(branch)

    observed = set(results)
    report = {
        'complete': expected == observed and not duplicates and not malformed and outer_failures == 0 and outer_timeouts == 0,
        'sourceTacyBinaryExactRunId': 37984707367,
        'sourceTacyBinaryExactArtifactId': 11643631020,
        'sourceTacyBinaryRoutingRunId': 38014113202,
        'sourceTacyBinaryRoutingAuditArtifactId': 11654409147,
        'splitKind': 'required-any-used-binary',
        'sparseCustomer': 'christina',
        'christinaCandidateGroups': CHRISTINA_CHOICES,
        'christinaSubsets': CHRISTINA_SUBSETS,
        'parentBranchCount': len(parents),
        'exactClosedTacyBranches': source['exactClosedTacyBranches'],
        'exactClosedUlbertBranches': source['exactClosedUlbertBranches'],
        'exactClosedMarthaBranches': source['exactClosedMarthaBranches'],
        'siblingFrotgaParentBranchCount': source['siblingFrotgaParentBranchCount'],
        'expectedBranches': len(expected),
        'observedBranches': len(observed),
        'missingBranches': [list(branch) for branch in sorted(expected - observed)],
        'unexpectedBranches': [list(branch) for branch in sorted(observed - expected)],
        'duplicateBranches': duplicates,
        'malformed': malformed,
        'outerFailures': outer_failures,
        'outerTimeouts': outer_timeouts,
        'statuses': dict(sorted(statuses.items())),
        'exactInfeasibleBranches': statuses.get('infeasible', 0),
        'masterTimeoutBranches': statuses.get('timelimit', 0),
        'roundLimitBranches': statuses.get('round-limit', 0),
        'fixedSupportTimeoutBranches': sum(count for status, count in statuses.items() if status.startswith('exact-') and status.endswith('timelimit')),
        'supportCuts': support_cuts,
        'exactInfeasibleSupports': exact_infeasible_supports,
        'fixedSupportExactAttempts': fixed_support_attempts,
        'exactSolveMs': exact_solve_ms,
        'witnessCount': len(witnesses),
        'globalWitnessCount': len(witnesses),
        'witnesses': witnesses,
        'branchesByStatus': {status: sorted(branches) for status, branches in sorted(branches_by_status.items())},
    }
    Path('identity-334-christina-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(json.dumps({
        'complete': report['complete'],
        'expectedBranches': report['expectedBranches'],
        'observedBranches': report['observedBranches'],
        'statuses': report['statuses'],
        'outerFailures': report['outerFailures'],
        'outerTimeouts': report['outerTimeouts'],
        'witnessCount': report['witnessCount'],
    }, sort_keys=True))
    if not report['complete']:
        raise SystemExit(1)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'prepare':
        prepare()
    elif mode == 'run':
        run_shard()
    elif mode == 'audit':
        audit()
    else:
        raise SystemExit('usage: diagnosis_branch21_christina.py prepare|run|audit')
