import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import diagnosis_branch21_ivo as exact
import diagnosis_branch21_post_nicholas as post

SOURCE_RUN_ID = 38112733603
SOURCE_AUDIT_ARTIFACT_ID = 11692534917
EXPECTED_STATUSES = {'infeasible': 1897, 'timelimit': 5051}
ROUTED = 'gavinus'
RESOLVED_SPARSE = 'ivo'
RESOLVED_CUSTOMERS = [
    'savius', 'ambrosia', 'octavius', 'oliver', 'hugo', 'tiffany', 'dominic',
    'heloise', 'solomon', *exact.NAMES, ROUTED, RESOLVED_SPARSE,
]
HISTORY_KEYS = [
    'newlyExactClosedPostNicholasBranches', 'exactClosedNicholasBranches',
    'exactClosedGonzaloBranches', 'exactClosedWilliamBranches',
    'exactClosedEmerysBranches', 'exactClosedChristinaBranches',
    'exactClosedTacyBranches', 'exactClosedUlbertBranches',
    'exactClosedMarthaBranches', 'siblingFrotgaParentBranchCount',
]


def _validate_branch(branch):
    assert isinstance(branch, list) and len(branch) == 22
    assert all(isinstance(value, int) for value in branch[:7])
    assert all(value in (0, 1) for value in branch[7:])
    prior_bits = branch[7:20]
    routed_bit = branch[20]
    ivo_bit = branch[21]
    assert len(prior_bits) == len(exact.NAMES) == 13
    return branch[:7], prior_bits, routed_bit, ivo_bit


def _validate_exact_audit(audit):
    assert audit['complete'] is True
    assert audit['sourcePostNicholasResidualRoutingRunId'] == 38104396220
    assert audit['sourcePostNicholasResidualRoutingSourceArtifactId'] == 11688309816
    assert audit['sourcePostNicholasResidualRoutingAuditArtifactId'] == 11690685514
    assert audit['splitKind'] == 'route-required-any-used-binary'
    assert audit['routedSparseCustomer'] == ROUTED
    assert audit['sparseCustomer'] == RESOLVED_SPARSE
    assert audit['ivoCandidateGroups'] == exact.IVO
    assert audit['ivoSubsets'] == exact.IVO_PARTS
    assert audit['parentBranchCount'] == 3474
    assert audit['deferredPaulineRouteParentCount'] == 5031
    assert audit['expectedBranches'] == audit['observedBranches'] == 6948
    assert audit['missingBranches'] == audit['unexpectedBranches'] == audit['duplicateBranches'] == audit['malformed'] == []
    assert audit['outerFailures'] == audit['outerTimeouts'] == 0
    assert audit['statuses'] == EXPECTED_STATUSES
    assert audit['exactInfeasibleBranches'] == 1897
    assert audit['masterTimeoutBranches'] == 5051
    assert audit['roundLimitBranches'] == 0
    assert audit['fixedSupportTimeoutBranches'] == 0
    assert audit['supportCuts'] == 0
    assert audit['exactInfeasibleSupports'] == 0
    assert audit['fixedSupportExactAttempts'] == 0
    assert audit['witnessCount'] == audit['globalWitnessCount'] == 0
    assert audit['witnesses'] == []
    residuals = audit['branchesByStatus']['timelimit']
    closed = audit['branchesByStatus']['infeasible']
    assert len(residuals) == len({tuple(branch) for branch in residuals}) == 5051
    assert len(closed) == len({tuple(branch) for branch in closed}) == 1897
    assert {tuple(branch) for branch in residuals}.isdisjoint({tuple(branch) for branch in closed})
    for branch in residuals:
        _validate_branch(branch)
    for branch in closed:
        _validate_branch(branch)
    return residuals


def prepare():
    audit = json.loads(Path('ivo-exact/identity-334-ivo-binary-exact-audit.json').read_text())
    residuals = sorted(_validate_exact_audit(audit))
    source = {
        'sourceIvoBinaryExactRunId': SOURCE_RUN_ID,
        'sourceIvoBinaryExactAuditArtifactId': SOURCE_AUDIT_ARTIFACT_ID,
        'statuses': audit['statuses'],
        'routedSparseCustomer': ROUTED,
        'resolvedSparseCustomer': RESOLVED_SPARSE,
        'parentBranches': residuals,
        'exactClosedIvoBranches': audit['exactInfeasibleBranches'],
        'deferredPaulineRouteParentCount': audit['deferredPaulineRouteParentCount'],
        **{key: audit[key] for key in HISTORY_KEYS},
    }
    Path('identity-334-ivo-residual-routing-source.json').write_text(
        json.dumps(source, indent=2, sort_keys=True) + '\n'
    )
    sizes = [len(residuals[(i - 1) * 60:i * 60]) for i in range(1, 86)]
    assert sizes[:-1] == [60] * 84
    assert sizes[-1] == 11
    assert sum(sizes) == 5051
    print('matrix=' + json.dumps({'include': [{'shard': i} for i in range(1, 86)]}, separators=(',', ':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    base_text = source_path.read_text()
    start_marker = "hallSignatureProfileIt(\n  'profiles Hall-closure membership signatures for unresolved 3+1+1 support',"
    end_marker = "\n  },\n  120000,\n)\n\n\nfunction build311HallSignatureSupportMaster"
    start = base_text.find(start_marker)
    end = base_text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit('test markers not found')
    base_test = base_text[start:end]

    parents = json.loads(os.environ['SHARD_BRANCHES'])
    assert 1 <= len(parents) <= 60
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-ivo-residual-routing] '
    results = []
    failed = False
    scalar_names = ['octavius', 'oliver', 'hugo', 'tiffany', 'dominic', 'heloise', 'solomon']

    for ordinal, branch in enumerate(parents, 1):
        scalars, prior_bits, routed_bit, ivo_bit = _validate_branch(branch)
        prior_subsets = [parts[bit] for parts, bit in zip(exact.SUBSETS, prior_bits)]
        routed_subset = post.ROUTED_SUBSETS[ROUTED][routed_bit]
        ivo_subset = exact.IVO_PARTS[ivo_bit]

        lines = [
            '',
            '    const fixedExactGroupIndex = 334',
            '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
            f"    const residualCustomerIds = domain.serviceableCustomerIds.filter((customerId) => !fixedExactCustomerSet.has(customerId) && !{json.dumps(RESOLVED_CUSTOMERS,separators=(',',':'))}.includes(customerId))",
            '    const requiredPair = [1052, 1070] as const',
            '    const saviusChoice = 692',
            '    const ambrosiaChoice = 1243',
        ]
        lines += [f'    const {name}Choice = {value}' for name, value in zip(scalar_names, scalars)]
        for name, bit, subset in zip(exact.NAMES, prior_bits, prior_subsets):
            lines += [
                f'    const {name}SplitIndex = {bit}',
                f'    const {name}Subset = {json.dumps(subset,separators=(",",":"))} as const',
            ]
        lines += [
            f"    const routedSparseCustomer = '{ROUTED}'",
            f'    const routedSplitIndex = {routed_bit}',
            f'    const routedSubset = {json.dumps(routed_subset,separators=(",",":"))} as const',
            f"    const sparseCustomer = '{RESOLVED_SPARSE}'",
            f'    const ivoSplitIndex = {ivo_bit}',
            f'    const ivoSubset = {json.dumps(ivo_subset,separators=(",",":"))} as const',
        ]
        lines += [
            f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))"
            for name in exact.NAMES
        ]
        lines += [
            '    routedSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(routedSparseCustomer))',
            '    ivoSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(sparseCustomer))',
            '    const alreadyRequiredUsedGroupIndexes = new Set<number>([fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice])',
            '    const candidatesForCustomer = (customerId: string) => groups.flatMap((group, candidateGroupIndex) => {',
            '      if (candidateGroupIndex === fixedExactGroupIndex) return []',
            '      const residualEligible = group.eligibleCustomerIds.filter((eligibleCustomerId) => !fixedExactCustomerSet.has(eligibleCustomerId))',
            '      if (!residualEligible.includes(customerId)) return []',
            '      const normal = residualEligible.length >= 2',
            '      const slack = group.ingredientCost === SLACK_RECIPE_COST && residualEligible.length >= 1',
            '      return normal || slack ? [{ groupIndex: candidateGroupIndex, slackOnly: !normal && slack }] : []',
            '    })',
            '    const sparseCustomers = residualCustomerIds.map((customerId) => ({ customerId, candidates: candidatesForCustomer(customerId) })).filter((entry) => entry.candidates.length > 0 && entry.candidates.every((candidate) => !alreadyRequiredUsedGroupIndexes.has(candidate.groupIndex))).sort((left, right) => left.candidates.length - right.candidates.length || left.customerId.localeCompare(right.customerId))',
            '    const sparse = sparseCustomers[0]',
            '    expect(sparse).toBeDefined()',
            '    if (sparse) {',
        ]
        payload_fields = [
            'fixedGroupIndex: fixedExactGroupIndex', 'extraOneCostSum: 89', 'companionCost: 53', 'pair: requiredPair',
            'octaviusChoice', 'oliverChoice', 'hugoChoice', 'tiffanyChoice', 'dominicChoice', 'heloiseChoice', 'solomonChoice',
        ]
        for name in exact.NAMES:
            payload_fields += [f'{name}SplitIndex', f'{name}Subset']
        payload_fields += [
            'routedSparseCustomer', 'routedSplitIndex', 'routedSubset',
            'sparseCustomer', 'ivoSplitIndex', 'ivoSubset',
            'nextSparseCustomer: sparse.customerId', 'candidateCount: sparse.candidates.length', 'candidates: sparse.candidates',
        ]
        lines += [
            f"      console.info('{marker.strip()}', JSON.stringify({{{', '.join(payload_fields)}}}))",
            '    }',
        ]

        source_path.write_text(base_text[:start] + base_test + '\n'.join(lines) + base_text[end:])
        cmd = [
            'npx', 'vitest', 'run', str(source_path), '--maxWorkers=1', '--minWorkers=1',
            '-t', r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support',
        ]
        try:
            done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
            output, code, timed = done.stdout, done.returncode, False
        except subprocess.TimeoutExpired as exc:
            output = (exc.stdout or '') if isinstance(exc.stdout, str) else (exc.stdout or b'').decode(errors='replace')
            code, timed = 124, True
        Path(f'branch-{ordinal}.log').write_text(output)
        marked = [ansi.sub('', line) for line in output.splitlines() if marker in ansi.sub('', line)]
        result = {
            'branch': branch,
            'routedSparseCustomer': ROUTED,
            'resolvedSparseCustomer': RESOLVED_SPARSE,
            'outerReturnCode': code,
            'outerTimeout': timed,
            'markerCount': len(marked),
            'routing': None,
        }
        if len(marked) == 1:
            result['routing'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
        failed |= code != 0 or len(marked) != 1
        results.append(result)

    source_path.write_text(base_text)
    Path('routing-results.json').write_text(json.dumps(results, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Ivo residual routing branches failed')


def audit():
    exact_audit = json.loads(Path('ivo-exact/identity-334-ivo-binary-exact-audit.json').read_text())
    residuals = _validate_exact_audit(exact_audit)
    source = json.loads(Path('ivo-routing-source/identity-334-ivo-residual-routing-source.json').read_text())
    assert source['sourceIvoBinaryExactRunId'] == SOURCE_RUN_ID
    assert source['sourceIvoBinaryExactAuditArtifactId'] == SOURCE_AUDIT_ARTIFACT_ID
    assert source['statuses'] == EXPECTED_STATUSES
    assert source['routedSparseCustomer'] == ROUTED
    assert source['resolvedSparseCustomer'] == RESOLVED_SPARSE
    assert source['exactClosedIvoBranches'] == 1897
    assert source['deferredPaulineRouteParentCount'] == 5031
    parents = source['parentBranches']
    assert len(parents) == len({tuple(branch) for branch in parents}) == 5051
    assert {tuple(branch) for branch in parents} == {tuple(branch) for branch in residuals}
    expected = {tuple(branch) for branch in parents}

    results = {}
    duplicates = []
    malformed = []
    outer_failures = 0
    outer_timeouts = 0
    sparse_counts = Counter()
    signatures = defaultdict(int)
    routed_parents = []
    files = list(Path('routing-shards').rglob('routing-results.json'))
    if len(files) != 85:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})

    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 60:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            try:
                scalars, prior_bits, routed_bit, ivo_bit = _validate_branch(branch)
            except (AssertionError, TypeError):
                malformed.append({'reason': 'branch-shape', 'branch': branch})
                continue
            if entry.get('routedSparseCustomer') != ROUTED or entry.get('resolvedSparseCustomer') != RESOLVED_SPARSE:
                malformed.append({'reason': 'route-chain', 'branch': branch})
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
            routing = entry.get('routing')
            if not isinstance(routing, dict):
                malformed.append({'reason': 'missing-routing', 'branch': branch})
                continue

            identity_ok = routing.get('routedSparseCustomer') == ROUTED
            identity_ok &= routing.get('routedSplitIndex') == routed_bit
            identity_ok &= routing.get('routedSubset') == post.ROUTED_SUBSETS[ROUTED][routed_bit]
            identity_ok &= routing.get('sparseCustomer') == RESOLVED_SPARSE
            identity_ok &= routing.get('ivoSplitIndex') == ivo_bit
            identity_ok &= routing.get('ivoSubset') == exact.IVO_PARTS[ivo_bit]
            for name, subsets, bit in zip(exact.NAMES, exact.SUBSETS, prior_bits):
                identity_ok &= routing.get(f'{name}SplitIndex') == bit
                identity_ok &= routing.get(f'{name}Subset') == subsets[bit]
            if not identity_ok:
                malformed.append({'reason': 'routing-identity', 'branch': branch})

            next_sparse = routing.get('nextSparseCustomer')
            candidates = routing.get('candidates')
            if not isinstance(next_sparse, str) or next_sparse in RESOLVED_CUSTOMERS:
                malformed.append({'reason': 'next-sparse-customer', 'branch': branch, 'nextSparseCustomer': next_sparse})
                continue
            if not isinstance(candidates, list) or routing.get('candidateCount') != len(candidates) or not candidates:
                malformed.append({'reason': 'candidate-shape', 'branch': branch})
                continue
            hard_required = {334, 1052, 1070, 692, 1243, *scalars}
            cand_key = []
            bad_candidate = False
            for candidate in candidates:
                group_index = candidate.get('groupIndex') if isinstance(candidate, dict) else None
                slack_only = candidate.get('slackOnly') if isinstance(candidate, dict) else None
                if not isinstance(group_index, int) or not isinstance(slack_only, bool) or group_index in hard_required:
                    bad_candidate = True
                    break
                cand_key.append((group_index, slack_only))
            if bad_candidate:
                malformed.append({'reason': 'candidate-entry', 'branch': branch})
                continue

            sparse_counts[next_sparse] += 1
            signatures[(next_sparse, tuple(cand_key))] += 1
            routed_parents.append({'branch': branch, 'nextSparseCustomer': next_sparse})

    observed = set(results)
    routing_signatures = [
        {
            'branchCount': count,
            'nextSparseCustomer': next_sparse,
            'candidates': [
                {'groupIndex': group_index, 'slackOnly': slack_only}
                for group_index, slack_only in cand_key
            ],
        }
        for (next_sparse, cand_key), count in sorted(signatures.items(), key=lambda item: item[0])
    ]
    report = {
        'complete': expected == observed and not duplicates and not malformed and outer_failures == 0 and outer_timeouts == 0,
        'sourceIvoBinaryExactRunId': SOURCE_RUN_ID,
        'sourceIvoBinaryExactAuditArtifactId': SOURCE_AUDIT_ARTIFACT_ID,
        'expectedBranches': len(expected),
        'observedBranches': len(observed),
        'missingBranches': [list(branch) for branch in sorted(expected - observed)],
        'unexpectedBranches': [list(branch) for branch in sorted(observed - expected)],
        'duplicateBranches': duplicates,
        'malformed': malformed,
        'outerFailures': outer_failures,
        'outerTimeouts': outer_timeouts,
        'routedSparseCustomer': ROUTED,
        'resolvedSparseCustomer': RESOLVED_SPARSE,
        'sparseCustomerCounts': dict(sorted(sparse_counts.items())),
        'routingSignatures': routing_signatures,
        'routedParents': sorted(routed_parents, key=lambda item: (item['branch'], item['nextSparseCustomer'])),
        'exactClosedIvoBranches': source['exactClosedIvoBranches'],
        'deferredPaulineRouteParentCount': source['deferredPaulineRouteParentCount'],
        **{key: source[key] for key in HISTORY_KEYS},
    }
    Path('identity-334-ivo-residual-routing-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(json.dumps({
        'complete': report['complete'],
        'expectedBranches': report['expectedBranches'],
        'observedBranches': report['observedBranches'],
        'outerFailures': report['outerFailures'],
        'outerTimeouts': report['outerTimeouts'],
        'sparseCustomerCounts': report['sparseCustomerCounts'],
        'routingSignatureCount': len(report['routingSignatures']),
    }, sort_keys=True))
    if not report['complete']:
        raise SystemExit('Ivo residual routing audit incomplete')


if __name__ == '__main__':
    if len(os.sys.argv) != 2 or os.sys.argv[1] not in {'prepare', 'run', 'audit'}:
        raise SystemExit('usage: diagnosis_branch21_ivo_routing.py {prepare|run|audit}')
    {'prepare': prepare, 'run': run_shard, 'audit': audit}[os.sys.argv[1]]()
