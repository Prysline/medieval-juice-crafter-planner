import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

import diagnosis_branch21_nicholas as prev

SPLIT_NAMES = [
    'betsy', 'julia', 'bernard', 'harry', 'charles', 'martha',
    'ulbert', 'tacy', 'christina', 'emerys', 'william', 'gonzalo', 'nicholas',
]
SUBSETS = {
    'betsy': prev.BETSY_SUBSETS,
    'julia': prev.JULIA_SUBSETS,
    'bernard': prev.BERNARD_SUBSETS,
    'harry': prev.HARRY_SUBSETS,
    'charles': prev.CHARLES_SUBSETS,
    'martha': prev.MARTHA_SUBSETS,
    'ulbert': prev.ULBERT_SUBSETS,
    'tacy': prev.TACY_SUBSETS,
    'christina': prev.CHRISTINA_SUBSETS,
    'emerys': prev.EMERYS_SUBSETS,
    'william': prev.WILLIAM_SUBSETS,
    'gonzalo': prev.GONZALO_SUBSETS,
    'nicholas': prev.NICHOLAS_SUBSETS,
}
RESOLVED_CUSTOMERS = [
    'savius', 'ambrosia', 'octavius', 'oliver', 'hugo', 'tiffany', 'dominic', 'heloise', 'solomon',
    *SPLIT_NAMES,
]


def prepare():
    audit = json.loads(Path('nicholas-exact/identity-334-nicholas-binary-exact-audit.json').read_text())
    assert audit['complete'] is True
    assert audit['sourceGonzaloBinaryExactRunId'] == 38043599182
    assert audit['sourceGonzaloBinaryExactArtifactId'] == 11667339782
    assert audit['sourceGonzaloBinaryRoutingRunId'] == 38055666477
    assert audit['sourceGonzaloBinaryRoutingAuditArtifactId'] == 11670943562
    assert audit['splitKind'] == 'required-any-used-binary'
    assert audit['sparseCustomer'] == 'nicholas'
    assert audit['nicholasCandidateGroups'] == prev.NICHOLAS_CHOICES
    assert audit['nicholasSubsets'] == prev.NICHOLAS_SUBSETS
    assert audit['expectedBranches'] == audit['observedBranches'] == 7378
    assert audit['missingBranches'] == audit['unexpectedBranches'] == audit['duplicateBranches'] == audit['malformed'] == []
    assert audit['outerFailures'] == audit['outerTimeouts'] == 0
    assert audit['statuses'] == {'infeasible': 1938, 'timelimit': 5440}
    assert audit['exactInfeasibleBranches'] == 1938
    assert audit['masterTimeoutBranches'] == 5440
    assert audit['roundLimitBranches'] == 0
    assert audit['fixedSupportTimeoutBranches'] == 0
    assert audit['supportCuts'] == 0
    assert audit['exactInfeasibleSupports'] == 0
    assert audit['fixedSupportExactAttempts'] == 0
    assert audit['exactSolveMs'] == 0
    assert audit['witnessCount'] == audit['globalWitnessCount'] == 0
    assert audit['witnesses'] == []
    assert audit['parentBranchCount'] == 3689
    assert audit['exactClosedGonzaloBranches'] == 1569
    assert audit['exactClosedWilliamBranches'] == 1115
    assert audit['exactClosedEmerysBranches'] == 542
    assert audit['exactClosedChristinaBranches'] == 733
    assert audit['exactClosedTacyBranches'] == 234
    assert audit['exactClosedUlbertBranches'] == 156
    assert audit['exactClosedMarthaBranches'] == 89
    assert audit['siblingFrotgaParentBranchCount'] == 1610
    residuals = audit['branchesByStatus']['timelimit']
    closed = audit['branchesByStatus']['infeasible']
    assert len(residuals) == 5440
    assert len({tuple(branch) for branch in residuals}) == 5440
    assert len({tuple(branch) for branch in closed}) == 1938
    assert {tuple(branch) for branch in residuals}.isdisjoint({tuple(branch) for branch in closed})
    assert all(len(branch) == 20 and all(value in (0, 1) for value in branch[-13:]) for branch in residuals)
    shards = []
    for i, start in enumerate(range(0, len(residuals), 60), 1):
        chunk = residuals[start:start + 60]
        shards.append({'shard': i, 'branches_json': json.dumps(chunk, separators=(',', ':'))})
    assert len(shards) == 91
    assert sum(len(json.loads(shard['branches_json'])) for shard in shards) == 5440
    assert [len(json.loads(shard['branches_json'])) for shard in shards[:-1]] == [60] * 90
    assert len(json.loads(shards[-1]['branches_json'])) == 40
    print('matrix=' + json.dumps({'include': shards}, separators=(',', ':')))


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
    branches = json.loads(os.environ['SHARD_BRANCHES'])
    assert 1 <= len(branches) <= 60
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-nicholas-binary-residual-routing] '
    results = []
    failed = False
    for ordinal, values in enumerate(branches, 1):
        assert len(values) == 20 and all(value in (0, 1) for value in values[-13:])
        scalar = values[:7]
        split_bits = values[-13:]
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon = scalar
        selected = {name: SUBSETS[name][bit] for name, bit in zip(SPLIT_NAMES, split_bits)}
        lines = [
            '',
            '    const fixedExactGroupIndex = 334',
            '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
            f"    const residualCustomerIds = domain.serviceableCustomerIds.filter((customerId) => !fixedExactCustomerSet.has(customerId) && !{json.dumps(RESOLVED_CUSTOMERS,separators=(',',':'))}.includes(customerId))",
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
        for name, bit in zip(SPLIT_NAMES, split_bits):
            lines.append(f'    const {name}SplitIndex = {bit}')
            lines.append(f'    const {name}Subset = {json.dumps(selected[name],separators=(",",":"))} as const')
        for name in SPLIT_NAMES:
            lines.append(f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))")
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
        for name in SPLIT_NAMES:
            payload_fields += [f'{name}SplitIndex', f'{name}Subset']
        payload_fields += ['sparseCustomer: sparse.customerId', 'candidateCount: sparse.candidates.length', 'candidates: sparse.candidates']
        lines.append(f"      console.info('{marker.strip()}', JSON.stringify({{{', '.join(payload_fields)}}}))")
        lines += ['    }']
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
        entry = {'branch': values, 'outerReturnCode': code, 'outerTimeout': timed, 'markerCount': len(marked), 'routing': None}
        if len(marked) == 1:
            entry['routing'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
        failed |= code != 0 or len(marked) != 1
        results.append(entry)
    source_path.write_text(base_text)
    Path('routing-results.json').write_text(json.dumps(results, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Nicholas residual routing branches failed')


def audit():
    source = json.loads(Path('nicholas-exact/identity-334-nicholas-binary-exact-audit.json').read_text())
    assert source['complete'] is True
    assert source['statuses'] == {'infeasible': 1938, 'timelimit': 5440}
    assert source['exactInfeasibleBranches'] == 1938
    assert source['masterTimeoutBranches'] == 5440
    assert source['witnessCount'] == source['globalWitnessCount'] == 0
    parents = source['branchesByStatus']['timelimit']
    expected = {tuple(branch) for branch in parents}
    assert len(parents) == len(expected) == 5440

    results = {}
    duplicates = []
    malformed = []
    outer_failures = []
    sparse_counts = Counter()
    signatures = defaultdict(int)
    files = list(Path('routing-shards').rglob('routing-results.json'))
    if len(files) != 91:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for path in files:
        entries = json.loads(path.read_text())
        if not 1 <= len(entries) <= 60:
            malformed.append({'reason': 'branch-count', 'path': str(path), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 20 or any(value not in (0, 1) for value in branch[-13:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch})
                continue
            key = tuple(branch)
            if key in results:
                duplicates.append(branch)
                continue
            results[key] = entry
            if entry.get('outerReturnCode') != 0 or entry.get('outerTimeout'):
                outer_failures.append(entry)
            routing = entry.get('routing')
            if not isinstance(routing, dict):
                malformed.append({'reason': 'missing-routing', 'branch': branch})
                continue
            split_bits = branch[-13:]
            bad_identity = False
            for name, bit in zip(SPLIT_NAMES, split_bits):
                if routing.get(f'{name}SplitIndex') != bit or routing.get(f'{name}Subset') != SUBSETS[name][bit]:
                    bad_identity = True
                    break
            if bad_identity:
                malformed.append({'reason': 'routing-identity', 'branch': branch})
            sparse = routing.get('sparseCustomer')
            candidates = routing.get('candidates')
            if not isinstance(sparse, str) or not isinstance(candidates, list):
                malformed.append({'reason': 'routing-shape', 'branch': branch})
                continue
            sparse_counts[sparse] += 1
            cand_key = tuple((candidate.get('groupIndex'), candidate.get('slackOnly')) for candidate in candidates)
            signatures[tuple(split_bits) + (sparse, cand_key)] += 1

    observed = set(results)
    routing_signatures = []
    for key, count in sorted(signatures.items(), key=lambda item: item[0]):
        split_bits = key[:13]
        sparse, cand_key = key[13], key[14]
        entry = {'branchCount': count, 'sparseCustomer': sparse}
        for name, bit in zip(SPLIT_NAMES, split_bits):
            entry[f'{name}SplitIndex'] = bit
        entry['candidates'] = [
            {'groupIndex': group_index, 'slackOnly': slack_only}
            for group_index, slack_only in cand_key
        ]
        routing_signatures.append(entry)

    report = {
        'complete': expected == observed and not duplicates and not malformed and not outer_failures,
        'sourceNicholasBinaryExactRunId': 38062004689,
        'sourceNicholasBinaryExactArtifactId': 11675208667,
        'expectedBranches': len(expected),
        'observedBranches': len(observed),
        'missingBranches': [list(branch) for branch in sorted(expected - observed)],
        'unexpectedBranches': [list(branch) for branch in sorted(observed - expected)],
        'duplicateBranches': duplicates,
        'malformed': malformed,
        'outerFailures': len(outer_failures),
        'sparseCustomerCounts': dict(sorted(sparse_counts.items())),
        'routingSignatures': routing_signatures,
        'exactClosedNicholasBranches': 1938,
        'exactClosedGonzaloBranches': source['exactClosedGonzaloBranches'],
        'exactClosedWilliamBranches': source['exactClosedWilliamBranches'],
        'exactClosedEmerysBranches': source['exactClosedEmerysBranches'],
        'exactClosedChristinaBranches': source['exactClosedChristinaBranches'],
        'exactClosedTacyBranches': source['exactClosedTacyBranches'],
        'exactClosedUlbertBranches': source['exactClosedUlbertBranches'],
        'exactClosedMarthaBranches': source['exactClosedMarthaBranches'],
        'siblingFrotgaParentBranchCount': source['siblingFrotgaParentBranchCount'],
    }
    Path('identity-334-nicholas-binary-routing-audit.json').write_text(
        json.dumps(report, indent=2, sort_keys=True) + '\n'
    )
    print(json.dumps({
        'complete': report['complete'],
        'expectedBranches': report['expectedBranches'],
        'observedBranches': report['observedBranches'],
        'sparseCustomerCounts': report['sparseCustomerCounts'],
        'routingSignatureCount': len(report['routingSignatures']),
        'outerFailures': report['outerFailures'],
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
        raise SystemExit('usage: diagnosis_branch21_nicholas_routing.py prepare|run|audit')
