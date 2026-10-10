import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_charles as base
import diagnosis_branch21_emerys as prev

BETSY_SUBSETS = prev.BETSY_SUBSETS
JULIA_SUBSETS = prev.JULIA_SUBSETS
BERNARD_SUBSETS = prev.BERNARD_SUBSETS
HARRY_SUBSETS = prev.HARRY_SUBSETS
CHARLES_SUBSETS = prev.CHARLES_SUBSETS
MARTHA_SUBSETS = prev.MARTHA_SUBSETS
ULBERT_SUBSETS = prev.ULBERT_SUBSETS
TACY_SUBSETS = prev.TACY_SUBSETS
CHRISTINA_SUBSETS = prev.CHRISTINA_SUBSETS
EMERYS_SUBSETS = prev.EMERYS_SUBSETS

SPLIT_NAMES = [
    'betsy', 'julia', 'bernard', 'harry', 'charles',
    'martha', 'ulbert', 'tacy', 'christina', 'emerys',
]
SPLIT_SUBSETS = [
    BETSY_SUBSETS, JULIA_SUBSETS, BERNARD_SUBSETS, HARRY_SUBSETS, CHARLES_SUBSETS,
    MARTHA_SUBSETS, ULBERT_SUBSETS, TACY_SUBSETS, CHRISTINA_SUBSETS, EMERYS_SUBSETS,
]

WILLIAM_CHOICES = [191, 221, 227, 506, 573, 579, 637, 654, 659, 664, 695, 702, 704, 866, 867, 878, 882, 889, 890, 892, 893, 895, 896, 897, 907, 908, 918, 921, 932, 933, 935, 936, 938, 939, 940, 956, 973, 976, 984, 985, 989, 990, 998, 1001, 1007, 1008, 1011, 1015, 1018, 1020, 1021, 1044, 1045, 1046, 1048, 1049, 1050, 1051, 1171, 1175, 1176, 1315]
WILLIAM_SUBSETS = [WILLIAM_CHOICES[:31], WILLIAM_CHOICES[31:]]


def candidate_groups(routing):
    candidates = routing.get('candidates')
    assert isinstance(candidates, list)
    assert all(candidate.get('slackOnly') is False for candidate in candidates)
    return [candidate.get('groupIndex') for candidate in candidates]


def validate_prior_routing_identity(routing, branch):
    split_bits = branch[-10:]
    for name, subsets, bit in zip(SPLIT_NAMES, SPLIT_SUBSETS, split_bits):
        assert routing[f'{name}SplitIndex'] == bit
        assert routing[f'{name}Subset'] == subsets[bit]


def prepare():
    exact = json.loads(Path('emerys-exact/identity-334-emerys-binary-exact-audit.json').read_text())
    routing_audit = json.loads(Path('emerys-routing/identity-334-emerys-binary-routing-audit.json').read_text())

    assert exact['complete'] is True
    assert exact['sourceChristinaBinaryExactRunId'] == 38015121516
    assert exact['sourceChristinaBinaryExactArtifactId'] == 11656292165
    assert exact['sourceChristinaBinaryRoutingRunId'] == 38028977869
    assert exact['sourceChristinaBinaryRoutingAuditArtifactId'] == 11661158580
    assert exact['splitKind'] == 'required-any-used-binary'
    assert exact['sparseCustomer'] == 'emerys'
    assert exact['emerysCandidateGroups'] == prev.EMERYS_CHOICES
    assert exact['emerysSubsets'] == EMERYS_SUBSETS
    assert exact['expectedBranches'] == exact['observedBranches'] == 2414
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 542, 'timelimit': 1872}
    assert exact['exactInfeasibleBranches'] == 542
    assert exact['masterTimeoutBranches'] == 1872
    assert exact['roundLimitBranches'] == 0
    assert exact['fixedSupportTimeoutBranches'] == 0
    assert exact['supportCuts'] == 0
    assert exact['exactInfeasibleSupports'] == 0
    assert exact['fixedSupportExactAttempts'] == 0
    assert exact['exactSolveMs'] == 0
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    assert exact['witnesses'] == []
    assert exact['parentBranchCount'] == 1207
    assert exact['exactClosedChristinaBranches'] == 733
    assert exact['exactClosedTacyBranches'] == 234
    assert exact['exactClosedUlbertBranches'] == 156
    assert exact['exactClosedMarthaBranches'] == 89
    assert exact['siblingFrotgaParentBranchCount'] == 1610
    residuals = exact['branchesByStatus']['timelimit']
    expected = {tuple(branch) for branch in residuals}
    assert len(residuals) == len(expected) == 1872
    assert all(len(branch) == 17 and all(value in (0, 1) for value in branch[-10:]) for branch in residuals)

    assert routing_audit['complete'] is True
    assert routing_audit['sourceEmerysBinaryExactRunId'] == 38030208025
    assert routing_audit['sourceEmerysBinaryExactArtifactId'] == 11661629649
    assert routing_audit['expectedBranches'] == routing_audit['observedBranches'] == 1872
    assert routing_audit['missingBranches'] == routing_audit['unexpectedBranches'] == routing_audit['duplicateBranches'] == routing_audit['malformed'] == []
    assert routing_audit['outerFailures'] == 0
    assert routing_audit['sparseCustomerCounts'] == {'william': 1872}
    assert routing_audit['exactClosedEmerysBranches'] == 542
    assert routing_audit['exactClosedChristinaBranches'] == 733
    assert routing_audit['exactClosedTacyBranches'] == 234
    assert routing_audit['exactClosedUlbertBranches'] == 156
    assert routing_audit['exactClosedMarthaBranches'] == 89
    assert routing_audit['siblingFrotgaParentBranchCount'] == 1610
    assert sum(entry['branchCount'] for entry in routing_audit['routingSignatures']) == 1872
    assert len(routing_audit['routingSignatures']) == 890
    for signature in routing_audit['routingSignatures']:
        assert signature['sparseCustomer'] == 'william'
        assert [candidate['groupIndex'] for candidate in signature['candidates']] == WILLIAM_CHOICES
        assert all(candidate['slackOnly'] is False for candidate in signature['candidates'])

    files = list(Path('emerys-routing-shards').rglob('routing-results.json'))
    assert len(files) == 32
    observed = set()
    william_parents = []
    for path in files:
        entries = json.loads(path.read_text())
        assert 1 <= len(entries) <= 60
        for entry in entries:
            branch = entry['branch']
            key = tuple(branch)
            assert len(branch) == 17 and all(value in (0, 1) for value in branch[-10:])
            assert key in expected and key not in observed
            assert entry['outerReturnCode'] == 0 and entry['outerTimeout'] is False and entry['markerCount'] == 1
            routing = entry['routing']
            validate_prior_routing_identity(routing, branch)
            assert routing['sparseCustomer'] == 'william'
            assert candidate_groups(routing) == WILLIAM_CHOICES
            william_parents.append(branch)
            observed.add(key)

    assert observed == expected
    assert len(william_parents) == 1872
    assert [len(part) for part in WILLIAM_SUBSETS] == [31, 31]
    assert set(WILLIAM_SUBSETS[0]).isdisjoint(WILLIAM_SUBSETS[1])
    assert set(WILLIAM_SUBSETS[0]) | set(WILLIAM_SUBSETS[1]) == set(WILLIAM_CHOICES)

    william_parents.sort()
    source = {
        'sourceEmerysBinaryExactRunId': 38030208025,
        'sourceEmerysBinaryExactArtifactId': 11661629649,
        'sourceEmerysBinaryRoutingRunId': 38035351318,
        'sourceEmerysBinaryRoutingAuditArtifactId': 11663848052,
        'sparseCustomer': 'william',
        'candidateGroups': WILLIAM_CHOICES,
        'subsets': WILLIAM_SUBSETS,
        'parentBranches': william_parents,
        'exactClosedEmerysBranches': 542,
        'exactClosedChristinaBranches': 733,
        'exactClosedTacyBranches': 234,
        'exactClosedUlbertBranches': 156,
        'exactClosedMarthaBranches': 89,
        'siblingFrotgaParentBranchCount': 1610,
    }
    Path('identity-334-william-binary-exact-source.json').write_text(json.dumps(source, indent=2, sort_keys=True) + '\n')
    shards = [
        {'shard': i + 1, 'parents_json': json.dumps(william_parents[start:start + 10], separators=(',', ':'))}
        for i, start in enumerate(range(0, len(william_parents), 10))
    ]
    assert len(shards) == 188
    assert sum(len(json.loads(shard['parents_json'])) for shard in shards) == 1872
    assert sum(len(json.loads(shard['parents_json'])) * 2 for shard in shards) == 3744
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = base.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 10
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-william-binary-result] '
    out = []
    failed = False
    ordinal = 0

    for parent in parents:
        assert len(parent) == 17 and all(value in (0, 1) for value in parent[-10:])
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon = parent[:7]
        split_bits = parent[7:]
        prior_subsets = [subsets[bit] for subsets, bit in zip(SPLIT_SUBSETS, split_bits)]
        for william_i, william_subset in enumerate(WILLIAM_SUBSETS):
            ordinal += 1
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
            ]
            for name, bit, subset in zip(SPLIT_NAMES, split_bits, prior_subsets):
                lines.extend([
                    f'    const {name}SplitIndex = {bit}',
                    f'    const {name}Subset = {json.dumps(subset,separators=(",",":"))} as const',
                ])
            lines.extend([
                f'    const williamSplitIndex = {william_i}',
                f'    const williamSubset = {json.dumps(william_subset,separators=(",",":"))} as const',
            ])
            for name in SPLIT_NAMES + ['william']:
                lines.append(f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))")
            required_any = ', '.join(f'{name}Subset' for name in SPLIT_NAMES + ['william'])
            identity_fields = ', '.join(
                [f'{name}SplitIndex, {name}Subset' for name in SPLIT_NAMES + ['william']]
            )
            lines.extend([
                '    const thresholdCounts = [3, 1, 1, 0] as const',
                '    const supportCuts: number[][] = []',
                "    let status = 'round-limit'",
                '    let masterSolveMs = 0',
                '    let exactSolveMs = 0',
                '    let exactInfeasibleSupports = 0',
                '    let fixedSupportExactAttempts = 0',
                '    for (let round = 0; round < 16; round += 1) {',
                f'      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, {{ supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice], requiredAnyUsedGroupIndexSets: [{required_any}], requiredExtraOneGroupIndexes: [...requiredPair] }})',
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
                f"    console.info('[machine-extra1-pair-william-binary-result]', JSON.stringify({{ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, {identity_fields}, sparseCustomer: 'william', status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }}))",
            ])
            source_path.write_text(patched[:start] + base_test + '\n'.join(lines) + patched[end:])
            cmd = [
                'npx', 'vitest', 'run', str(source_path), '--maxWorkers=1', '--minWorkers=1',
                '-t', r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support',
            ]
            try:
                done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
                text, code, timed = done.stdout, done.returncode, False
            except subprocess.TimeoutExpired as exc:
                text = (exc.stdout or '') if isinstance(exc.stdout, str) else (exc.stdout or b'').decode(errors='replace')
                code, timed = 124, True
            Path(f'branch-{ordinal}.log').write_text(text)
            marked = [ansi.sub('', line) for line in text.splitlines() if marker in ansi.sub('', line)]
            entry = {
                'branch': parent + [william_i],
                'outerReturnCode': code,
                'outerTimeout': timed,
                'markerCount': len(marked),
                'solver': None,
            }
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            failed |= code != 0 or len(marked) != 1
            out.append(entry)

    source_path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more William binary exact branches failed')


def audit():
    source = json.loads(Path('william-source/identity-334-william-binary-exact-source.json').read_text())
    assert source['sourceEmerysBinaryExactRunId'] == 38030208025
    assert source['sourceEmerysBinaryExactArtifactId'] == 11661629649
    assert source['sourceEmerysBinaryRoutingRunId'] == 38035351318
    assert source['sourceEmerysBinaryRoutingAuditArtifactId'] == 11663848052
    assert source['sparseCustomer'] == 'william'
    assert source['candidateGroups'] == WILLIAM_CHOICES
    assert source['subsets'] == WILLIAM_SUBSETS
    assert source['exactClosedEmerysBranches'] == 542
    assert source['exactClosedChristinaBranches'] == 733
    assert source['exactClosedTacyBranches'] == 234
    assert source['exactClosedUlbertBranches'] == 156
    assert source['exactClosedMarthaBranches'] == 89
    assert source['siblingFrotgaParentBranchCount'] == 1610

    parents = source['parentBranches']
    assert len(parents) == 1872
    assert len({tuple(parent) for parent in parents}) == 1872
    assert all(len(parent) == 17 and all(value in (0, 1) for value in parent[-10:]) for parent in parents)
    expected = {tuple(parent + [split]) for parent in parents for split in (0, 1)}
    assert len(expected) == 3744

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
    if len(files) != 188:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})

    all_names = SPLIT_NAMES + ['william']
    all_subsets = SPLIT_SUBSETS + [WILLIAM_SUBSETS]
    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 20:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 18 or any(value not in (0, 1) for value in branch[-11:]):
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

            bits = branch[-11:]
            identity_ok = solver.get('sparseCustomer') == 'william'
            for name, subsets, bit in zip(all_names, all_subsets, bits):
                identity_ok = (
                    identity_ok
                    and solver.get(f'{name}SplitIndex') == bit
                    and solver.get(f'{name}Subset') == subsets[bit]
                )
            if not identity_ok:
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
        'sourceEmerysBinaryExactRunId': 38030208025,
        'sourceEmerysBinaryExactArtifactId': 11661629649,
        'sourceEmerysBinaryRoutingRunId': 38035351318,
        'sourceEmerysBinaryRoutingAuditArtifactId': 11663848052,
        'splitKind': 'required-any-used-binary',
        'sparseCustomer': 'william',
        'williamCandidateGroups': WILLIAM_CHOICES,
        'williamSubsets': WILLIAM_SUBSETS,
        'parentBranchCount': len(parents),
        'exactClosedEmerysBranches': source['exactClosedEmerysBranches'],
        'exactClosedChristinaBranches': source['exactClosedChristinaBranches'],
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
        'fixedSupportTimeoutBranches': sum(
            count for status, count in statuses.items()
            if status.startswith('exact-') and status.endswith('timelimit')
        ),
        'supportCuts': support_cuts,
        'exactInfeasibleSupports': exact_infeasible_supports,
        'fixedSupportExactAttempts': fixed_support_attempts,
        'exactSolveMs': exact_solve_ms,
        'witnessCount': len(witnesses),
        'globalWitnessCount': len(witnesses),
        'witnesses': witnesses,
        'branchesByStatus': {
            status: sorted(branches) for status, branches in sorted(branches_by_status.items())
        },
    }
    Path('identity-334-william-binary-exact-audit.json').write_text(
        json.dumps(report, indent=2, sort_keys=True) + '\n'
    )
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
        raise SystemExit('usage: diagnosis_branch21_william.py prepare|run|audit')
