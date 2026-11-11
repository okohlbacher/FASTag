#!/usr/bin/env python3
"""Independent unique-peak, b/y-only raw-spectrum evidence at 20 ppm."""
import bisect,json,math
from pathlib import Path
import numpy as np
import pandas as pd
from audit_truth import HERE,SOURCE,decode,WATER
PROTON=1.007276466621
ISO=1.003354835

def support(spec,peptide,tolerance=20.,unit='ppm'):
    seq,masses,n,c,_=decode(peptide);total=sum(masses)+n+c+WATER
    obs=spec['charge']*(spec['precursor_mz']-PROTON)
    residual=obs-total;iso=round(residual/ISO)
    mz=spec['mz'];intensity=spec['intensity'];matches=[]
    prefix=n
    for cut in range(1,len(seq)):
        prefix+=masses[cut-1]
        for series,neutral,index in [('b',prefix,cut),('y',total-prefix,len(seq)-cut)]:
            for z in range(1,min(2,spec['charge'])+1):
                theoretical=(neutral+z*PROTON)/z
                window=theoretical*tolerance*1e-6 if unit=='ppm' else tolerance
                low=bisect.bisect_left(mz,theoretical-window);high=bisect.bisect_right(mz,theoretical+window)
                if low==high:continue
                ix=max(range(low,high),key=lambda i:intensity[i])
                matches.append(dict(ion=series+str(index)+(f'^{z}' if z>1 else ''),series=series,index=index,charge=z,cut=cut,
                                    peak_index=ix,mz=mz[ix],theoretical_mz=theoretical,ppm=(mz[ix]-theoretical)/theoretical*1e6,intensity=intensity[ix]))
    peakids=set(m['peak_index'] for m in matches)
    denom=sum(intensity);nonreporter=sum(v for m,v in zip(mz,intensity) if m>150)
    errors=[m['mz']-m['theoretical_mz'] for m in matches]
    mono_mz=total/spec['charge']+PROTON
    isolated=(spec['isolation_target']-spec['isolation_lower'] <= mono_mz <= spec['isolation_target']+spec['isolation_upper'])
    return dict(peptide=peptide,fragment_tolerance=tolerance,fragment_tolerance_unit=unit,
                fragment_signed_da_quantiles={str(q):float(np.quantile(errors,q)) for q in [0,.25,.5,.75,1]} if errors else {},
                neutral_mass=total,theoretical_mono_mz=mono_mz,monoisotopic_mz_inside_isolation_window=isolated,precursor_neutral=obs,
                precursor_error_da=residual,precursor_error_ppm=residual/total*1e6,
                nearest_isotope=iso,isotope_corrected_error_da=residual-iso*ISO,
                isotope_corrected_error_ppm=(residual-iso*ISO)/total*1e6,
                matched_ions=len(matches),matched_unique_peaks=len(peakids),
                unique_peak_explained_TIC_pct=100*sum(intensity[i] for i in peakids)/denom if denom else 0,
                unique_peak_explained_TIC_above150_pct=100*sum(intensity[i] for i in peakids if mz[i]>150)/nonreporter if nonreporter else 0,
                cleavage_coverage=sum(any(m['cut']==i for m in matches) for i in range(1,len(seq))),
                cleavage_count=len(seq)-1,matches=matches)

def main():
    independent=pd.read_csv(HERE/'independent_candidates.tsv.gz',sep='\t')
    cases=[];summary=[]
    for path in sorted((HERE/'raw-spectra').glob('*.json')):
        if 'old_conversion' in path.name:continue
        data=json.loads(path.read_text());ds=data['id']
        truth=pd.read_csv(SOURCE/ds/'truth.filtered.sage.tsv',sep='\t');truth['key']=truth.scannr.str.extract(r'(scan=\d+)')[0];truth=truth.set_index('key')
        for spec in data['spectra']:
            key='scan='+spec['scan'];row=truth.loc[key]
            candidates=[('Sage',row.peptide,True,float(row.spectrum_q))]
            alt=independent[(independent.dataset==ds)&(independent.key==key)]
            candidates += [(r.engine,r.peptide,bool(r.accepted),float(r.q)) for r in alt.itertuples()]
            supports=[];original=[]
            for engine,peptide,accepted,q in candidates:
                record=support(spec,peptide);record.update(engine=engine,independent_engine_accepted=accepted,engine_q=q);supports.append(record)
                if ds=='PXD000001':
                    record=support(spec,peptide,.2,'Da');record.update(engine=engine,independent_engine_accepted=accepted,engine_q=q);original.append(record)
            for record in supports:
                others=[s for s in supports if s['peptide']!=record['peptide']]
                otherids=set(m['peak_index'] for s in others for m in s['matches'])
                own=set(m['peak_index'] for m in record['matches'])
                record['candidate_exclusive_peaks']=len(own-otherids) if others else None
                record['candidate_exclusive_TIC_pct']=100*sum(spec['intensity'][i] for i in own-otherids)/sum(spec['intensity']) if others else None
                summary.append(dict(dataset=ds,key=key,**{k:v for k,v in record.items() if k!='matches'}))
            cases.append(dict(dataset=ds,key=key,input=data['input'],spectrum=spec,
                              sage={field:(value.item() if isinstance(value,np.generic) else value) for field,value in row.items()},
                              supports=supports,original_search_tolerance_support=original))
    (HERE/'spectrum_support.json').write_text(json.dumps(dict(method='All b/y cleavage ions; fragment charges 1..min(2,precursor charge); 20 ppm; highest-intensity peak in each ion window. TIC counts each raw peak once per peptide. No neutral-loss ions, a ions, deisotoping, or denoising. Precursor nearest-isotope reported descriptively, not used to accept a candidate.',cases=cases),indent=2)+'\n')
    pd.DataFrame(summary).to_csv(HERE/'spectrum_support.tsv',sep='\t',index=False)
    print(pd.DataFrame(summary)[['dataset','key','engine','matched_unique_peaks','unique_peak_explained_TIC_pct','precursor_error_da','cleavage_coverage','cleavage_count']].to_string(index=False))
    new=json.loads((HERE/'raw-spectra/PXD000001.json').read_text());old=json.loads((HERE/'raw-spectra/PXD000001_old_conversion.json').read_text())
    a={r['scan']:r for r in new['metadata']};b={r['scan']:r for r in old['metadata']};common=set(a)&set(b)
    detail={}
    for field in ['precursor_mz','charge','rt','isolation_target','isolation_lower','isolation_upper']:
        diffs=[abs(a[k][field]-b[k][field]) for k in common]
        detail[field]=dict(equal=sum(d==0 for d in diffs),max_absolute_difference=max(diffs))
    a={r['scan']:r for r in new['spectra']};b={r['scan']:r for r in old['spectra']};peakdetail=[]
    for key in sorted(set(a)&set(b),key=int):
        pairs_a=set(zip(a[key]['mz'],a[key]['intensity']));pairs_b=set(zip(b[key]['mz'],b[key]['intensity']))
        peakdetail.append(dict(scan=key,new_peaks=len(a[key]['mz']),old_peaks=len(b[key]['mz']),
                              arrays_exact_equal=a[key]['mz']==b[key]['mz'] and a[key]['intensity']==b[key]['intensity'],
                              exact_common_pairs=len(pairs_a & pairs_b),new_pairs_subset_of_old=pairs_a<=pairs_b,
                              precursor_new=a[key]['precursor_mz'],precursor_old=b[key]['precursor_mz']))
    (HERE/'erwinia_conversion_comparison.json').write_text(json.dumps(dict(new_input=new['input'],old_input=old['input'],new_ms2=new['ms2_count'],old_ms2=old['ms2_count'],common_scans=len(common),metadata=detail,selected_peak_arrays=peakdetail),indent=2)+'\n')

if __name__=='__main__':main()
