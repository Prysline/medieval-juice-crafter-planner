import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

BETSY_SUBSETS = [[180,258,418,489,497,536,541,547],[552,554,564,576,595,619,623,632]]
JULIA_SUBSETS = [[60,81,120,124,160,161,163,253,270],[284,287,328,329,330,331,401,419,443]]
BERNARD_CHOICES = [63,132,140,149,171,185,545,568,585,756,1155,1163,1223,1255,1260,1269,1274,1329,1353,1360,1362,1408,1409]
BERNARD_SUBSETS = [BERNARD_CHOICES[:12], BERNARD_CHOICES[12:]]


def prepare():
    audit = json.loads(Path('bernard-exact/identity-334-bernard-binary-exact-audit.json').read_text())
    assert audit['complete'] is True
    assert audit['sourceJuliaBinaryExactRunId'] == 37753097739
    assert audit['sourceJuliaBinaryExactArtifactId'] == 11548521516
    assert audit['sourceBernardRoutingRunId'] == 37783422241
    assert audit['sourceBernardRoutingArtifactId'] == 11560475212
    assert audit['splitKind'] == 'required-any-used-binary'
    assert audit['bernardCandidateGroups'] == BERNARD_CHOICES
    assert audit['bernardSubsets'] == BERNARD_SUBSETS
    assert audit['expectedBranches'] == audit['observedBranches'] == 28796
    assert audit['missingBranches'] == audit['unexpectedBranches'] == audit['duplicateBranches'] == audit['malformed'] == []
    assert audit['outerFailures'] == audit['outerTimeouts'] == 0
    assert audit['statuses'] == {'infeasible': 5730, 'timelimit': 23066}
    assert audit['exactInfeasibleBranches'] == 5730
    assert audit['masterTimeoutBranches'] == 23066
    assert audit['roundLimitBranches'] == 0
    assert audit['fixedSupportTimeoutBranches'] == 0
    assert audit['supportCuts'] == 0
    assert audit['exactInfeasibleSupports'] == 0
    assert audit['fixedSupportExactAttempts'] == 0
    assert audit['exactSolveMs'] == 0
    assert audit['witnessCount'] == audit['globalWitnessCount'] == 0
    assert audit['witnesses'] == []
    residuals = audit['branchesByStatus']['timelimit']
    assert len(residuals) == 23066
    assert all(len(x) == 10 and all(v in (0,1) for v in x[-3:]) for x in residuals)
    shards = []
    for i, start in enumerate(range(0, len(residuals), 96), 1):
        chunk = residuals[start:start+96]
        shards.append({'shard': i, 'branches_json': json.dumps(chunk, separators=(',',':'))})
    assert len(shards) == 241
    assert sum(len(json.loads(s['branches_json'])) for s in shards) == 23066
    assert max(len(json.loads(s['branches_json'])) for s in shards) <= 96
    print('matrix=' + json.dumps({'include': shards}, separators=(',',':')))


def run_shard():
    source_path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    base_text = source_path.read_text()
    start_marker = "hallSignatureProfileIt(\n  'profiles Hall-closure membership signatures for unresolved 3+1+1 support',"
    end_marker = "\n  },\n  120000,\n)\n\n\nfunction build311HallSignatureSupportMaster"
    start = base_text.find(start_marker); end = base_text.find(end_marker, start)
    if start < 0 or end < 0: raise SystemExit('test markers not found')
    base_test = base_text[start:end]
    branches = json.loads(os.environ['SHARD_BRANCHES'])
    assert 1 <= len(branches) <= 96
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-bernard-binary-residual-routing] '
    results = []; failed = False
    for ordinal, values in enumerate(branches, 1):
        assert len(values) == 10 and all(v in (0,1) for v in values[-3:])
        octavius, oliver, hugo, tiffany, dominic, heloise, solomon, betsy_i, julia_i, bernard_i = values
        b = BETSY_SUBSETS[betsy_i]; j = JULIA_SUBSETS[julia_i]; r = BERNARD_SUBSETS[bernard_i]
        lines = [
            '', '    const fixedExactGroupIndex = 334',
            '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
            "    const residualCustomerIds = domain.serviceableCustomerIds.filter((customerId) => !fixedExactCustomerSet.has(customerId) && !['savius','ambrosia','octavius','oliver','hugo','tiffany','dominic','heloise','solomon','betsy','julia','bernard'].includes(customerId))",
            '    const requiredPair = [1052, 1070] as const', '    const saviusChoice = 692', '    const ambrosiaChoice = 1243',
            f'    const octaviusChoice = {octavius}', f'    const oliverChoice = {oliver}', f'    const hugoChoice = {hugo}', f'    const tiffanyChoice = {tiffany}', f'    const dominicChoice = {dominic}', f'    const heloiseChoice = {heloise}', f'    const solomonChoice = {solomon}',
            f'    const betsySplitIndex = {betsy_i}', f'    const betsySubset = {json.dumps(b,separators=(",",":"))} as const',
            f'    const juliaSplitIndex = {julia_i}', f'    const juliaSubset = {json.dumps(j,separators=(",",":"))} as const',
            f'    const bernardSplitIndex = {bernard_i}', f'    const bernardSubset = {json.dumps(r,separators=(",",":"))} as const',
            "    betsySubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('betsy'))",
            "    juliaSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('julia'))",
            "    bernardSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('bernard'))",
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
            '    const sparse = sparseCustomers[0]', '    expect(sparse).toBeDefined()', '    if (sparse) {',
            "      console.info('[machine-extra1-pair-bernard-binary-residual-routing]', JSON.stringify({ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, octaviusChoice, oliverChoice, hugoChoice, tiffanyChoice, dominicChoice, heloiseChoice, solomonChoice, betsySplitIndex, betsySubset, juliaSplitIndex, juliaSubset, bernardSplitIndex, bernardSubset, sparseCustomer: sparse.customerId, candidateCount: sparse.candidates.length, candidates: sparse.candidates }))",
            '    }',
        ]
        source_path.write_text(base_text[:start] + base_test + '\n'.join(lines) + base_text[end:])
        cmd=['npx','vitest','run',str(source_path),'--maxWorkers=1','--minWorkers=1','-t',r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support']
        try:
            done=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=150); output=done.stdout; code=done.returncode; timed=False
        except subprocess.TimeoutExpired as exc:
            output=(exc.stdout or '') if isinstance(exc.stdout,str) else (exc.stdout or b'').decode(errors='replace'); code=124; timed=True
        Path(f'branch-{ordinal}.log').write_text(output)
        marked=[ansi.sub('',x) for x in output.splitlines() if marker in ansi.sub('',x)]
        entry={'branch':values,'betsySubset':b,'juliaSubset':j,'bernardSubset':r,'outerReturnCode':code,'outerTimeout':timed,'markerCount':len(marked),'routing':None}
        if len(marked)==1: entry['routing']=json.loads(marked[0][marked[0].find(marker)+len(marker):])
        if code!=0 or len(marked)!=1: failed=True
        results.append(entry)
    source_path.write_text(base_text)
    Path('routing-results.json').write_text(json.dumps(results,indent=2,sort_keys=True)+'\n')
    if failed: raise SystemExit('one or more Bernard residual routing branches failed')


def audit():
    source=json.loads(Path('bernard-exact/identity-334-bernard-binary-exact-audit.json').read_text())
    parents=source['branchesByStatus']['timelimit']; assert len(parents)==23066
    expected={tuple(x) for x in parents}; results={}; duplicates=[]; malformed=[]; outer_failures=[]; sparse_counts=Counter(); signatures=defaultdict(int)
    files=list(Path('routing-shards').rglob('routing-results.json'))
    if len(files)!=241: malformed.append({'reason':'shard-result-count','count':len(files)})
    for path in files:
        entries=json.loads(path.read_text())
        if not 1 <= len(entries) <= 96: malformed.append({'reason':'branch-count','path':str(path),'count':len(entries)})
        for entry in entries:
            branch=entry.get('branch')
            if not isinstance(branch,list) or len(branch)!=10 or any(v not in (0,1) for v in branch[-3:]): malformed.append({'reason':'branch-shape','branch':branch}); continue
            key=tuple(branch)
            if key in results: duplicates.append(branch); continue
            results[key]=entry
            if entry.get('outerReturnCode')!=0 or entry.get('outerTimeout'): outer_failures.append(entry)
            routing=entry.get('routing')
            if not isinstance(routing,dict): malformed.append({'reason':'missing-routing','branch':branch}); continue
            if routing.get('betsySplitIndex')!=branch[-3] or routing.get('juliaSplitIndex')!=branch[-2] or routing.get('bernardSplitIndex')!=branch[-1]: malformed.append({'reason':'routing-identity','branch':branch})
            sparse=routing.get('sparseCustomer'); candidates=routing.get('candidates')
            if not isinstance(sparse,str) or not isinstance(candidates,list): malformed.append({'reason':'routing-shape','branch':branch}); continue
            sparse_counts[sparse]+=1
            cand_key=tuple((c.get('groupIndex'),c.get('slackOnly')) for c in candidates)
            signatures[(branch[-3],branch[-2],branch[-1],sparse,cand_key)] += 1
    observed=set(results)
    routing_signatures=[]
    for (b,j,r,sparse,cand_key),count in sorted(signatures.items(), key=lambda x:(x[0][0],x[0][1],x[0][2],x[0][3],x[0][4])):
        routing_signatures.append({'betsySplitIndex':b,'juliaSplitIndex':j,'bernardSplitIndex':r,'branchCount':count,'sparseCustomer':sparse,'candidates':[{'groupIndex':g,'slackOnly':slack} for g,slack in cand_key]})
    report={'complete': expected==observed and not duplicates and not malformed and not outer_failures,'sourceBernardBinaryExactRunId':37802187352,'sourceBernardBinaryExactArtifactId':11574742299,'expectedBranches':len(expected),'observedBranches':len(observed),'missingBranches':[list(x) for x in sorted(expected-observed)],'unexpectedBranches':[list(x) for x in sorted(observed-expected)],'duplicateBranches':duplicates,'malformed':malformed,'outerFailures':len(outer_failures),'sparseCustomerCounts':dict(sorted(sparse_counts.items())),'routingSignatures':routing_signatures}
    Path('identity-334-bernard-binary-routing-audit.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print('[machine-extra1-pair-bernard-binary-routing-audit]',json.dumps(report,separators=(',',':')))
    if not report['complete']: raise SystemExit('Bernard binary residual routing audit incomplete')


if __name__=='__main__':
    {'prepare':prepare,'run':run_shard,'audit':audit}[sys.argv[1]]()
