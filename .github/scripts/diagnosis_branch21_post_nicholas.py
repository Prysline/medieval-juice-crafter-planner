import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_charles as base
import diagnosis_branch21_nicholas as prev

PRIOR_SPLIT_NAMES = prev.SPLIT_NAMES + ['nicholas']
PRIOR_SPLIT_SUBSETS = prev.SPLIT_SUBSETS + [prev.NICHOLAS_SUBSETS]

GAVINUS_CHOICES = [
    120, 284, 299, 310, 328, 329, 330, 331, 399, 400, 401, 406, 419, 438, 439,
    443, 451, 472, 478, 483, 490, 494, 498, 512, 517, 521, 522, 523, 524, 525,
    528, 530, 531, 540, 542, 548, 549, 555, 556, 557, 580, 588, 591, 596, 601,
    602, 603, 612, 613, 614, 615, 616, 620, 624, 629, 634, 639, 640, 641, 642,
    643, 644, 651, 656, 661, 667, 668, 673, 675, 677, 679, 683, 684, 685, 686,
    688, 689, 696, 697, 698, 705, 707, 708, 709, 710, 711,
]
PAULINE_CHOICES = [
    28, 77, 142, 145, 146, 148, 182, 214, 218, 224, 251, 255, 258, 262, 267,
    304, 305, 414, 418, 442, 497, 547, 552, 554, 604, 619, 623, 627, 632, 693,
    701, 706, 721, 758, 760, 761, 781, 785, 789, 793, 797, 904, 910, 911, 926,
    927, 928, 929, 930, 947, 948, 949, 966, 967, 968, 969, 970, 971, 972, 973,
    974, 975, 976, 977, 978, 979, 980, 995, 1031, 1032, 1033, 1034, 1035, 1036,
    1037, 1038, 1039, 1040, 1041, 1047, 1174, 1281, 1316, 1317, 1318,
]
ROUTED_CHOICES = {'gavinus': GAVINUS_CHOICES, 'pauline': PAULINE_CHOICES}
ROUTED_SUBSETS = {
    'gavinus': [GAVINUS_CHOICES[:43], GAVINUS_CHOICES[43:]],
    'pauline': [PAULINE_CHOICES[:43], PAULINE_CHOICES[43:]],
}


def _candidate_groups(routing):
    candidates = routing.get('candidates')
    assert isinstance(candidates, list)
    assert all(candidate.get('slackOnly') is False for candidate in candidates)
    return [candidate.get('groupIndex') for candidate in candidates]


def _validate_prior_identity(payload, branch):
    bits = branch[-13:]
    for name, subsets, bit in zip(PRIOR_SPLIT_NAMES, PRIOR_SPLIT_SUBSETS, bits):
        assert payload.get(f'{name}SplitIndex') == bit
        assert payload.get(f'{name}Subset') == subsets[bit]


def prepare():
    exact = json.loads(Path('nicholas-exact/identity-334-nicholas-binary-exact-audit.json').read_text())
    routing_audit = json.loads(Path('nicholas-routing/identity-334-nicholas-binary-routing-audit.json').read_text())

    assert exact['complete'] is True
    assert exact['sourceGonzaloBinaryExactRunId'] == 38043599182
    assert exact['sourceGonzaloBinaryExactArtifactId'] == 11667339782
    assert exact['sourceGonzaloBinaryRoutingRunId'] == 38055666477
    assert exact['sourceGonzaloBinaryRoutingAuditArtifactId'] == 11670943562
    assert exact['splitKind'] == 'required-any-used-binary'
    assert exact['sparseCustomer'] == 'nicholas'
    assert exact['nicholasCandidateGroups'] == prev.NICHOLAS_CHOICES
    assert exact['nicholasSubsets'] == prev.NICHOLAS_SUBSETS
    assert exact['expectedBranches'] == exact['observedBranches'] == 7378
    assert exact['missingBranches'] == exact['unexpectedBranches'] == exact['duplicateBranches'] == exact['malformed'] == []
    assert exact['outerFailures'] == exact['outerTimeouts'] == 0
    assert exact['statuses'] == {'infeasible': 1938, 'timelimit': 5440}
    assert exact['exactInfeasibleBranches'] == 1938
    assert exact['masterTimeoutBranches'] == 5440
    assert exact['roundLimitBranches'] == 0
    assert exact['fixedSupportTimeoutBranches'] == 0
    assert exact['supportCuts'] == 0
    assert exact['exactInfeasibleSupports'] == 0
    assert exact['fixedSupportExactAttempts'] == 0
    assert exact['witnessCount'] == exact['globalWitnessCount'] == 0
    residuals = exact['branchesByStatus']['timelimit']
    expected = {tuple(branch) for branch in residuals}
    assert len(residuals) == len(expected) == 5440
    assert all(len(branch) == 20 and all(value in (0, 1) for value in branch[-13:]) for branch in residuals)

    assert routing_audit['complete'] is True
    assert routing_audit['sourceNicholasBinaryExactRunId'] == 38062004689
    assert routing_audit['sourceNicholasBinaryExactArtifactId'] == 11675208667
    assert routing_audit['expectedBranches'] == routing_audit['observedBranches'] == 5440
    assert routing_audit['missingBranches'] == routing_audit['unexpectedBranches'] == routing_audit['duplicateBranches'] == routing_audit['malformed'] == []
    assert routing_audit['outerFailures'] == 0
    assert routing_audit['sparseCustomerCounts'] == {'gavinus': 2341, 'pauline': 3099}
    assert routing_audit['exactClosedNicholasBranches'] == 1938
    assert sum(entry['branchCount'] for entry in routing_audit['routingSignatures']) == 5440
    for signature in routing_audit['routingSignatures']:
        sparse = signature['sparseCustomer']
        assert sparse in ROUTED_CHOICES
        assert [candidate['groupIndex'] for candidate in signature['candidates']] == ROUTED_CHOICES[sparse]
        assert all(candidate['slackOnly'] is False for candidate in signature['candidates'])

    files = list(Path('nicholas-routing-shards').rglob('routing-results.json'))
    assert len(files) == 91
    observed = set()
    routed_parents = []
    counts = Counter()
    for path in files:
        entries = json.loads(path.read_text())
        assert 1 <= len(entries) <= 60
        for entry in entries:
            branch = entry['branch']
            key = tuple(branch)
            assert len(branch) == 20 and all(value in (0, 1) for value in branch[-13:])
            assert key in expected and key not in observed
            assert entry['outerReturnCode'] == 0 and entry['outerTimeout'] is False and entry['markerCount'] == 1
            routing = entry['routing']
            _validate_prior_identity(routing, branch)
            sparse = routing['sparseCustomer']
            assert sparse in ROUTED_CHOICES
            assert _candidate_groups(routing) == ROUTED_CHOICES[sparse]
            routed_parents.append({'branch': branch, 'sparseCustomer': sparse})
            counts[sparse] += 1
            observed.add(key)

    assert observed == expected
    assert counts == Counter({'pauline': 3099, 'gavinus': 2341})
    for sparse, choices in ROUTED_CHOICES.items():
        parts = ROUTED_SUBSETS[sparse]
        assert [len(part) for part in parts] == ([43, 43] if sparse == 'gavinus' else [43, 42])
        assert set(parts[0]).isdisjoint(parts[1])
        assert set(parts[0]) | set(parts[1]) == set(choices)

    routed_parents.sort(key=lambda item: (item['branch'], item['sparseCustomer']))
    source = {
        'sourceNicholasBinaryExactRunId': 38062004689,
        'sourceNicholasBinaryExactArtifactId': 11675208667,
        'sourceNicholasBinaryRoutingRunId': 38067144653,
        'sourceNicholasBinaryRoutingAuditArtifactId': 11675424050,
        'routingCounts': dict(sorted(counts.items())),
        'candidateGroupsByCustomer': ROUTED_CHOICES,
        'subsetsByCustomer': ROUTED_SUBSETS,
        'parentBranches': routed_parents,
        'exactClosedNicholasBranches': 1938,
        'exactClosedGonzaloBranches': exact['exactClosedGonzaloBranches'],
        'exactClosedWilliamBranches': exact['exactClosedWilliamBranches'],
        'exactClosedEmerysBranches': exact['exactClosedEmerysBranches'],
        'exactClosedChristinaBranches': exact['exactClosedChristinaBranches'],
        'exactClosedTacyBranches': exact['exactClosedTacyBranches'],
        'exactClosedUlbertBranches': exact['exactClosedUlbertBranches'],
        'exactClosedMarthaBranches': exact['exactClosedMarthaBranches'],
        'siblingFrotgaParentBranchCount': exact['siblingFrotgaParentBranchCount'],
    }
    Path('identity-334-post-nicholas-routed-binary-exact-source.json').write_text(json.dumps(source, indent=2, sort_keys=True) + '\n')
    shards = [
        {'shard': i + 1, 'parents_json': json.dumps(routed_parents[start:start + 22], separators=(',', ':'))}
        for i, start in enumerate(range(0, len(routed_parents), 22))
    ]
    assert len(shards) == 248
    sizes = [len(json.loads(shard['parents_json'])) for shard in shards]
    assert sizes[:-1] == [22] * 247
    assert sizes[-1] == 6
    assert sum(sizes) == 5440
    assert sum(size * 2 for size in sizes) == 10880
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = source_path.read_text()
    patched, start, end, base_test = base.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 22
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-post-nicholas-routed-binary-result] '
    out = []
    failed = False
    ordinal = 0

    for parent_entry in parents:
        parent = parent_entry['branch']
        sparse_customer = parent_entry['sparseCustomer']
        assert sparse_customer in ROUTED_SUBSETS
        assert len(parent) == 20 and all(value in (0, 1) for value in parent[-13:])
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon = parent[:7]
        split_bits = parent[7:]
        prior_subsets = [subsets[bit] for subsets, bit in zip(PRIOR_SPLIT_SUBSETS, split_bits)]
        for route_i, route_subset in enumerate(ROUTED_SUBSETS[sparse_customer]):
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
            for name, bit, subset in zip(PRIOR_SPLIT_NAMES, split_bits, prior_subsets):
                lines.extend([
                    f'    const {name}SplitIndex = {bit}',
                    f'    const {name}Subset = {json.dumps(subset,separators=(",",":"))} as const',
                ])
            lines.extend([
                f"    const routedSparseCustomer = '{sparse_customer}'",
                f'    const routedSplitIndex = {route_i}',
                f'    const routedSubset = {json.dumps(route_subset,separators=(",",":"))} as const',
            ])
            for name in PRIOR_SPLIT_NAMES:
                lines.append(f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))")
            lines.append(f"    routedSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{sparse_customer}'))")
            required_any = ', '.join([*(f'{name}Subset' for name in PRIOR_SPLIT_NAMES), 'routedSubset'])
            identity_fields = ', '.join(f'{name}SplitIndex, {name}Subset' for name in PRIOR_SPLIT_NAMES)
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
                f"    console.info('{marker.strip()}', JSON.stringify({{ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, {identity_fields}, routedSparseCustomer, routedSplitIndex, routedSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }}))",
            ])
            source_path.write_text(patched[:start] + base_test + '\n'.join(lines) + patched[end:])
            cmd = [
                'npx', 'vitest', 'run', str(source_path), '--maxWorkers=1', '--minWorkers=1',
                '-t', r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support',
            ]
            try:
                done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
                text, code, timed = done.stdout, done.returncode, False
            except subprocess.TimeoutExpired as exc:
                text = (exc.stdout or '') if isinstance(exc.stdout, str) else (exc.stdout or b'').decode(errors='replace')
                code, timed = 124, True
            Path(f'branch-{ordinal}.log').write_text(text)
            marked = [ansi.sub('', line) for line in text.splitlines() if marker in ansi.sub('', line)]
            entry = {
                'branch': parent + [route_i],
                'sparseCustomer': sparse_customer,
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
        raise SystemExit('one or more post-Nicholas routed binary exact branches failed')


def audit():
    source = json.loads(Path('post-nicholas-source/identity-334-post-nicholas-routed-binary-exact-source.json').read_text())
    assert source['sourceNicholasBinaryExactRunId'] == 38062004689
    assert source['sourceNicholasBinaryExactArtifactId'] == 11675208667
    assert source['sourceNicholasBinaryRoutingRunId'] == 38067144653
    assert source['sourceNicholasBinaryRoutingAuditArtifactId'] == 11675424050
    assert source['routingCounts'] == {'gavinus': 2341, 'pauline': 3099}
    assert source['candidateGroupsByCustomer'] == ROUTED_CHOICES
    assert source['subsetsByCustomer'] == ROUTED_SUBSETS
    assert source['exactClosedNicholasBranches'] == 1938

    parents = source['parentBranches']
    assert len(parents) == 5440
    expected_routes = {tuple(item['branch']): item['sparseCustomer'] for item in parents}
    assert len(expected_routes) == 5440
    assert Counter(expected_routes.values()) == Counter({'pauline': 3099, 'gavinus': 2341})
    expected = {(tuple(item['branch'] + [split]), item['sparseCustomer']) for item in parents for split in (0, 1)}
    assert len(expected) == 10880

    files = list(Path('exact-shards').rglob('exact-results.json'))
    results = {}
    duplicates = []
    malformed = []
    outer_failures = 0
    outer_timeouts = 0
    statuses = Counter()
    statuses_by_customer = Counter()
    support_cuts = 0
    exact_infeasible_supports = 0
    fixed_support_attempts = 0
    exact_solve_ms = 0
    witnesses = []
    branches_by_status = {}
    shard_sizes = []
    if len(files) != 248:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})

    for path in files:
        entries = json.loads(path.read_text())
        shard_sizes.append(len(entries))
        if not 2 <= len(entries) <= 44 or len(entries) % 2 != 0:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            sparse = entry.get('sparseCustomer')
            if not isinstance(branch, list) or len(branch) != 21 or any(value not in (0, 1) for value in branch[-14:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch})
                continue
            parent = tuple(branch[:-1])
            if sparse != expected_routes.get(parent):
                malformed.append({'reason': 'route-identity', 'branch': branch, 'sparseCustomer': sparse})
                continue
            key = (tuple(branch), sparse)
            if key in results:
                duplicates.append({'branch': branch, 'sparseCustomer': sparse})
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
            prior_bits = branch[-14:-1]
            identity_ok = solver.get('routedSparseCustomer') == sparse
            for name, subsets, bit in zip(PRIOR_SPLIT_NAMES, PRIOR_SPLIT_SUBSETS, prior_bits):
                identity_ok = identity_ok and solver.get(f'{name}SplitIndex') == bit and solver.get(f'{name}Subset') == subsets[bit]
            route_bit = branch[-1]
            identity_ok = identity_ok and solver.get('routedSplitIndex') == route_bit and solver.get('routedSubset') == ROUTED_SUBSETS[sparse][route_bit]
            if not identity_ok:
                malformed.append({'reason': 'solver-identity', 'branch': branch, 'sparseCustomer': sparse})

            status = solver.get('status')
            if not isinstance(status, str):
                malformed.append({'reason': 'solver-status', 'branch': branch})
                continue
            statuses[status] += 1
            statuses_by_customer[(sparse, status)] += 1
            branches_by_status.setdefault(status, []).append({'branch': branch, 'sparseCustomer': sparse})
            support_cuts += int(solver.get('supportCuts') or 0)
            exact_infeasible_supports += int(solver.get('exactInfeasibleSupports') or 0)
            fixed_support_attempts += int(solver.get('fixedSupportExactAttempts') or 0)
            exact_solve_ms += int(solver.get('exactSolveMs') or 0)
            if status == 'global-witness':
                witnesses.append({'branch': branch, 'sparseCustomer': sparse})

    if Counter(shard_sizes) != Counter({44: 247, 12: 1}):
        malformed.append({'reason': 'shard-size-distribution', 'counts': dict(sorted(Counter(shard_sizes).items()))})

    observed = set(results)
    report = {
        'complete': expected == observed and not duplicates and not malformed and outer_failures == 0 and outer_timeouts == 0,
        'sourceNicholasBinaryExactRunId': 38062004689,
        'sourceNicholasBinaryExactArtifactId': 11675208667,
        'sourceNicholasBinaryRoutingRunId': 38067144653,
        'sourceNicholasBinaryRoutingAuditArtifactId': 11675424050,
        'splitKind': 'routed-required-any-used-binary',
        'routingCounts': source['routingCounts'],
        'candidateGroupsByCustomer': ROUTED_CHOICES,
        'subsetsByCustomer': ROUTED_SUBSETS,
        'parentBranchCount': len(parents),
        'exactClosedNicholasBranches': source['exactClosedNicholasBranches'],
        'exactClosedGonzaloBranches': source['exactClosedGonzaloBranches'],
        'exactClosedWilliamBranches': source['exactClosedWilliamBranches'],
        'exactClosedEmerysBranches': source['exactClosedEmerysBranches'],
        'exactClosedChristinaBranches': source['exactClosedChristinaBranches'],
        'exactClosedTacyBranches': source['exactClosedTacyBranches'],
        'exactClosedUlbertBranches': source['exactClosedUlbertBranches'],
        'exactClosedMarthaBranches': source['exactClosedMarthaBranches'],
        'siblingFrotgaParentBranchCount': source['siblingFrotgaParentBranchCount'],
        'expectedBranches': len(expected),
        'observedBranches': len(observed),
        'missingBranches': [{'branch': list(branch), 'sparseCustomer': sparse} for branch, sparse in sorted(expected - observed)],
        'unexpectedBranches': [{'branch': list(branch), 'sparseCustomer': sparse} for branch, sparse in sorted(observed - expected)],
        'duplicateBranches': duplicates,
        'malformed': malformed,
        'outerFailures': outer_failures,
        'outerTimeouts': outer_timeouts,
        'statuses': dict(sorted(statuses.items())),
        'statusesByCustomer': {
            sparse: {status: statuses_by_customer.get((sparse, status), 0) for status in sorted(statuses)}
            for sparse in sorted(ROUTED_CHOICES)
        },
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
        'branchesByStatus': {status: sorted(branches, key=lambda item: (item['branch'], item['sparseCustomer'])) for status, branches in sorted(branches_by_status.items())},
    }
    Path('identity-334-post-nicholas-routed-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(json.dumps({
        'complete': report['complete'],
        'expectedBranches': report['expectedBranches'],
        'observedBranches': report['observedBranches'],
        'statuses': report['statuses'],
        'statusesByCustomer': report['statusesByCustomer'],
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
        raise SystemExit('usage: diagnosis_branch21_post_nicholas.py prepare|run|audit')
