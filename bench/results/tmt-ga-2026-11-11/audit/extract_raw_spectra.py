#!/usr/bin/env python3
"""Extract explicitly requested spectra and independent raw precursor metadata."""
import array, base64, hashlib, json, re, sys, zlib
import xml.etree.ElementTree as ET
from pathlib import Path
NS={'m':'http://psi.hupo.org/ms/mzml'}

def cv(node,accession,default=None):
    hit=node.find('.//m:cvParam[@accession="'+accession+'"]',NS)
    return default if hit is None else hit.attrib.get('value',default)

def arrays(node):
    out={}
    for binary in node.findall('.//m:binaryDataArray',NS):
        name='mz' if cv(binary,'MS:1000514') is not None else 'intensity' if cv(binary,'MS:1000515') is not None else None
        if name is None:continue
        data=base64.b64decode(binary.find('m:binary',NS).text or '')
        if cv(binary,'MS:1000574') is not None:data=zlib.decompress(data)
        dtype='d' if cv(binary,'MS:1000523') is not None else 'f'
        values=array.array(dtype);values.frombytes(data)
        out[name]=list(values)
    return out

def read(path,wanted):
    selected=[];metadata=[]
    for event,node in ET.iterparse(path,events=('end',)):
        if node.tag.split('}')[-1]!='spectrum':continue
        identifier=node.attrib['id'];scan=re.search(r'scan=(\d+)',identifier)
        scan=scan[1] if scan else identifier
        level=int(cv(node,'MS:1000511','0'))
        if level==2:
            meta={'scan':scan,'native_id':identifier,'ms_level':level,
                  'precursor_mz':float(cv(node,'MS:1000744','0')),
                  'charge':int(cv(node,'MS:1000041','0')),
                  'rt':float(cv(node,'MS:1000016','0')),
                  'isolation_target':float(cv(node,'MS:1000827','0')),
                  'isolation_lower':float(cv(node,'MS:1000828','0')),
                  'isolation_upper':float(cv(node,'MS:1000829','0'))}
            metadata.append(meta)
            if scan in wanted:selected.append({**meta,**arrays(node)})
        node.clear()
    return {'input':path,'ms2_count':len(metadata),'metadata':metadata,'spectra':selected}

def main():
    requests=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);out.mkdir(exist_ok=True,parents=True)
    for task in requests:
        result=read(task['input'],set(str(s).replace('scan=','') for s in task['scans']))
        result.update({k:v for k,v in task.items() if k not in ['scans','input']})
        dest=out/(task['id']+'.json');dest.write_text(json.dumps(result,separators=(',',':'))+'\n')
        print(task['id'],result['ms2_count'],len(result['spectra']),str(dest),flush=True)

if __name__=='__main__':main()
