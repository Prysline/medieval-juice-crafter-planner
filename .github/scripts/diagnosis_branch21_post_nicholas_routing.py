import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import diagnosis_branch21_post_nicholas as prev

PRIOR_SPLIT_NAMES = prev.PRIOR_SPLIT_NAMES
PRIOR_SPLIT_SUBSETS = prev.PRIOR_SPLIT_SUBSETS
RESOLVED_CUSTOMERS = [
    'savius', 'ambrosia', 'octavius', 'oliver', 'hugo', 'tiffany', 'dominic',
    'heloise', 'solomon', *PRIOR_SPLIT_NAMES,
]
SOURCE_RUN_ID = 38070874020
SOURCE_AUDIT_ARTIFACT_ID = 11678832876
EXPECTED_STATUSES = {'infeasible': 2375, 'timelimit': 8505}
EXPECTED_TIMELIMIT_BY_CUSTOMER = {'gavinus': 3474, 'pauline': 5031}


def _identity_key(entry):
    return tuple(entry['branch']), entry['sparseCustomer']


def _validate_parent(entry):
    branch = entry['branch']
    routed_sparse = entry['sparseCustomer']
    assert routed_sparse in prev.ROUTED_SUBSETS
    assert len(branch) == 21
    assert all(value in (0, 1) for value in branch[7:])
    prior_bits = branch[7:20]
    routed_bit = branch[20]
    assert len(prior_bits) == len(PRIOR_SPLIT_NAMES) == 13
    assert routed_bit in (0, 1)
    return branch, routed_sparse, prior_bits, routed_bit


def prepare():
    audit = json.loads(Path('post-nicholas-exact/identity-334-post-nicholas-routed-binary-exact-audit.json').read_text())
    assert audit['complete'] is True
    assert audit['sourceNicholasBinaryExactRunId'] == 38062004689
    assert audit['sourceNicholasBinaryExactArtifactId'] == 11675208667
    assert audit['sourceNicholasBinaryRoutingRunId'] == 38067144653
    assert audit['sourceNicholasBinaryRoutingAuditArtifactId'] == 11675424050
    assert audit['splitKind'] == 'routed-required-any-used-binary'
    assert audit['expectedBranches'] == audit['observedBranches'] == 10880
    assert audit['missingBranches'] == audit['unexpectedBranches'] == audit['duplicateBranches'] == audit['malformed'] == []
    assert audit['outerFailures'] == audit['outerTimeouts'] == 0
    assert audit['statuses'] == EXPECTED_STATUSES
    assert audit['statusesByCustomer'] == {
        'gavinus': {'infeasible': 1208, 'timelimit': 3474},
        'pauline': {'infeasible': 1167, 'timelimit': 5031},
    }
    assert audit['exactInfeasibleBranches'] == 2375
    assert audit['masterTimeoutBranches'] == 8505
    assert audit['roundLimitBranches'] == 0
    assert audit['fixedSupportTimeoutBranches'] == 0
    assert audit['supportCuts'] == 0
    assert audit['fixedSupportExactAttempts'] == 0
    assert audit['exactInfeasibleSupports'] == 0
    assert audit['witnessCount'] == audit['globalWitnessCount'] == 0
    assert audit['witnesses'] == []
    assert audit['parentBranchCount'] == 5440
    assert audit['routingCounts'] == {'gavinus': 2341, 'pauline': 3099}
    assert audit['candidateGroupsByCustomer'] == prev.ROUTED_CHOICES
    assert audit['subsetsByCustomer'] == prev.ROUTED_SUBSETS

    residuals = audit['branchesByStatus']['timelimit']
    closed = audit['branchesByStatus']['infeasible']
    assert len(residuals) == 8505
    assert len(closed) == 2375
    residual_keys = {_identity_key(entry) for entry in residuals}
    closed_keys = {_identity_key(entry) for entry in closed}
    assert len(residual_keys) == 8505
    assert len(closed_keys) == 2375
    assert residual_keys.isdisjoint(closed_keys)

    counts = Counter()
    for entry in residuals:
        _validate_parent(entry)
        counts[entry['sparseCustomer']] += 1
    assert counts == Counter(EXPECTED_TIMELIMIT_BY_CUSTOMER)

    source = {
        'sourcePostNicholasExactRunId': SOURCE_RUN_ID,
        'sourcePostNicholasExactAuditArtifactId': SOURCE_AUDIT_ARTIFACT_ID,
        'statuses': audit['statuses'],
        'statusesByCustomer': audit['statusesByCustomer'],
        'routedParentCounts': dict(sorted(counts.items())),
        'parentBranches': residuals,
        'newlyExactClosedPostNicholasBranches': 2375,
        'exactClosedNicholasBranches': audit['exactClosedNicholasBranches'],
        'exactClosedGonzaloBranches': audit['exactClosedGonzaloBranches'],
        'exactClosedWilliamBranches': audit['exactClosedWilliamBranches'],
        'exactClosedEmerysBranches': audit['exactClosedEmerysBranches'],
        'exactClosedChristinaBranches': audit['exactClosedChristinaBranches'],
        'exactClosedTacyBranches': audit['exactClosedTacyBranches'],
        'exactClosedUlbertBranches': audit['exactClosedUlbertBranches'],
        'exactClosedMarthaBranches': audit['exactClosedMarthaBranches'],
        'siblingFrotgaParentBranchCount': audit['siblingFrotgaParentBranchCount'],
    }
    Path('identity-334-post-nicholas-residual-routing-source.json').write_text(
        json.dumps(source, indent=2, sort_keys=True) + '\n'
    )
    shard_indexes = [{'shard': i} for i in range(1, 143)]
    sizes = [len(residuals[(i - 1) * 60:i * 60]) for i in range(1, 143)]
    assert sizes[:-1] == [60] * 141
    assert sizes[-1] == 45
    assert sum(sizes) == 8505
    print('matrix=' + json.dumps({'include': shard_indexes}, separators=(',', ':')))


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
    marker = '[machine-extra1-pair-post-nicholas-residual-routing] '
    results = []
    failed = False

    for ordinal, parent_entry in enumerate(parents, 1):
        values, routed_sparse, split_bits, routed_bit = _validate_parent(parent_entry)
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon = values[:7]
        prior_selected = [subsets[bit] for subsets, bit in zip(PRIOR_SPLIT_SUBSETS, split_bits)]
        routed_subset = prev.ROUTED_SUBSETS[routed_sparse][routed_bit]
        resolved_customers = [*RESOLVED_CUSTOMERS, routed_sparse]

        lines = [
            '',
            '    const fixedExactGroupIndex = 334',
            '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
            f"    const residualCustomerIds = domain.serviceableCustomerIds.filter((customerId) => !fixedExactCustomerSet.has(customerId) && !{json.dumps(resolved_customers,separators=(',',':'))}.includes(customerId))",
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
        for name, bit, subset in zip(PRIOR_SPLIT_NAMES, split_bits, prior_selected):
            lines.extend([
                f'    const {name}SplitIndex = {bit}',
                f'    const {name}Subset = {json.dumps(subset,separators=(",",":"))} as const',
            ])
        lines.extend([
            f"    const routedSparseCustomer = '{routed_sparse}'",
            f'    const routedSplitIndex = {routed_bit}',
            f'    const routedSubset = {json.dumps(routed_subset,separators=(",",":"))} as const',
        ])
        for name in PRIOR_SPLIT_NAMES:
            lines.append(f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))")
        lines.append("    routedSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(routedSparseCustomer))")
        lines += [
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
        for name in PRIOR_SPLIT_NAMES:
            payload_fields += [f'{name}SplitIndex', f'{name}Subset']
        payload_fields += [
            'routedSparseCustomer', 'routedSplitIndex', 'routedSubset',
            'sparseCustomer: sparse.customerId', 'candidateCount: sparse.candidates.length', 'candidates: sparse.candidates',
        ]
        lines.append(f"      console.info('{marker.strip()}', JSON.stringify({{{', '.join(payload_fields)}}}))")
        lines.append('    }')

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
            'branch': values,
            'routedSparseCustomer': routed_sparse,
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
        raise SystemExit('one or more post-Nicholas residual routing branches failed')


def audit():
    source = json.loads(Path('post-nicholas-exact/identity-334-post-nicholas-routed-binary-exact-audit.json').read_text())
    assert source['complete'] is True
    assert source['statuses'] == EXPECTED_STATUSES
    parents = source['branchesByStatus']['timelimit']
    expected = {_identity_key(entry) for entry in parents}
    assert len(parents) == len(expected) == 8505

    results = {}
    duplicates = []
    malformed = []
    outer_failures = []
    sparse_counts = Counter()
    routed_parent_counts = Counter()
    signatures = defaultdict(int)
    files = list(Path('routing-shards').rglob('routing-results.json'))
    if len(files) != 142:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})

    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 60:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            routed_sparse = entry.get('routedSparseCustomer')
            parent = {'branch': branch, 'sparseCustomer': routed_sparse}
            try:
                _validate_parent(parent)
            except (AssertionError, KeyError, TypeError):
                malformed.append({'reason': 'branch-shape', 'branch': branch, 'routedSparseCustomer': routed_sparse})
                continue
            key = (tuple(branch), routed_sparse)
            if key in results:
                duplicates.append({'branch': branch, 'routedSparseCustomer': routed_sparse})
                continue
            results[key] = entry
            routed_parent_counts[routed_sparse] += 1
            if entry.get('outerReturnCode') != 0 or entry.get('outerTimeout'):
                outer_failures.append(entry)
            routing = entry.get('routing')
            if not isinstance(routing, dict):
                malformed.append({'reason': 'missing-routing', 'branch': branch, 'routedSparseCustomer': routed_sparse})
                continue

            split_bits = branch[7:20]
            routed_bit = branch[20]
            bad_identity = routing.get('routedSparseCustomer') != routed_sparse
            bad_identity |= routing.get('routedSplitIndex') != routed_bit
            bad_identity |= routing.get('routedSubset') != prev.ROUTED_SUBSETS[routed_sparse][routed_bit]
            for name, subsets, bit in zip(PRIOR_SPLIT_NAMES, PRIOR_SPLIT_SUBSETS, split_bits):
                if routing.get(f'{name}SplitIndex') != bit or routing.get(f'{name}Subset') != subsets[bit]:
                    bad_identity = True
                    break
            if bad_identity:
                malformed.append({'reason': 'routing-identity', 'branch': branch, 'routedSparseCustomer': routed_sparse})

            sparse = routing.get('sparseCustomer')
            candidates = routing.get('candidates')
            if not isinstance(sparse, str) or not isinstance(candidates, list):
                malformed.append({'reason': 'routing-shape', 'branch': branch, 'routedSparseCustomer': routed_sparse})
                continue
            if sparse == routed_sparse:
                malformed.append({'reason': 'rerouted-resolved-customer', 'branch': branch, 'routedSparseCustomer': routed_sparse})
            sparse_counts[sparse] += 1
            cand_key = tuple((candidate.get('groupIndex'), candidate.get('slackOnly')) for candidate in candidates)
            signatures[(routed_sparse, *split_bits, routed_bit, sparse, cand_key)] += 1

    observed = set(results)
    routing_signatures = []
    for key, count in sorted(signatures.items(), key=lambda item: item[0]):
        routed_sparse = key[0]
        split_bits = key[1:14]
        routed_bit = key[14]
        sparse = key[15]
        cand_key = key[16]
        report_entry = {
            'branchCount': count,
            'routedSparseCustomer': routed_sparse,
            'routedSplitIndex': routed_bit,
            'sparseCustomer': sparse,
            'candidates': [
                {'groupIndex': group_index, 'slackOnly': slack_only}
                for group_index, slack_only in cand_key
            ],
        }
        for name, bit in zip(PRIOR_SPLIT_NAMES, split_bits):
            report_entry[f'{name}SplitIndex'] = bit
        routing_signatures.append(report_entry)

    report = {
        'complete': expected == observed and not duplicates and not malformed and not outer_failures,
        'sourcePostNicholasExactRunId': SOURCE_RUN_ID,
        'sourcePostNicholasExactAuditArtifactId': SOURCE_AUDIT_ARTIFACT_ID,
        'expectedBranches': len(expected),
        'observedBranches': len(observed),
        'missingBranches': [
            {'branch': list(branch), 'routedSparseCustomer': routed_sparse}
            for branch, routed_sparse in sorted(expected - observed)
        ],
        'unexpectedBranches': [
            {'branch': list(branch), 'routedSparseCustomer': routed_sparse}
            for branch, routed_sparse in sorted(observed - expected)
        ],
        'duplicateBranches': duplicates,
        'malformed': malformed,
        'outerFailures': len(outer_failures),
        'routedParentCounts': dict(sorted(routed_parent_counts.items())),
        'sparseCustomerCounts': dict(sorted(sparse_counts.items())),
        'routingSignatures': routing_signatures,
        'newlyExactClosedPostNicholasBranches': 2375,
        'exactClosedNicholasBranches': source['exactClosedNicholasBranches'],
        'exactClosedGonzaloBranches': source['exactClosedGonzaloBranches'],
        'exactClosedWilliamBranches': source['exactClosedWilliamBranches'],
        'exactClosedEmerysBranches': source['exactClosedEmerysBranches'],
        'exactClosedChristinaBranches': source['exactClosedChristinaBranches'],
        'exactClosedTacyBranches': source['exactClosedTacyBranches'],
        'exactClosedUlbertBranches': source['exactClosedUlbertBranches'],
        'exactClosedMarthaBranches': source['exactClosedMarthaBranches'],
        'siblingFrotgaParentBranchCount': source['siblingFrotgaParentBranchCount'],
    }
    Path('identity-334-post-nicholas-residual-routing-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report['complete']:
        raise SystemExit('post-Nicholas residual routing audit incomplete')


if __name__ == '__main__':
    if len(os.sys.argv) != 2 or os.sys.argv[1] not in {'prepare', 'run', 'audit'}:
        raise SystemExit('usage: diagnosis_branch21_post_nicholas_routing.py {prepare|run|audit}')
    {'prepare': prepare, 'run': run_shard, 'audit': audit}[os.sys.argv[1]]()
