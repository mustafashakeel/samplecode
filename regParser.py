#!/usr/bin/python

# This is a tool that is used to parse the fpgareg.json file to generate various output formats
# fpgareg json file defines a model that will be used by various template files to generate
# application code

import os.path
import sys
import getopt
import time

import json
import re
import importlib

import generators

_parms = {
    'infile': False,
    'tdir': False,
    'outdir': False 
}


goldenRegisters = False                       # Global golden registers object

# We define this Struct class so we can convert a dict to an object
class Struct(object):
    def __init__(self, data):
        for name, value in data.iteritems():
            setattr(self, name, self._wrap(value))

    def _wrap(self, value):
        if isinstance(value, (tuple, list, set, frozenset)): 
            return type(value)([self._wrap(v) for v in value])
        else:
            return Struct(value) if isinstance(value, dict) else value


# Prints usage info and then dies
def usage():
    print """
%s - Parses the golden fpga registers json file
Options
    -d <full directory path to generate output in>
    -i <full path to the json document file>
    -t <full path to the directory where template files can be found>


""" % os.path.basename(sys.argv[0])
    sys.exit()


# Used to parse our command line arguments
def parseArgs():
    global _parms
    
    i=1
    argc = len(sys.argv)
    if (argc <= 1):
        usage()
    
    try:
        while i < argc:
            option = sys.argv[i]
            if option == '-d':
                i+=1
                _parms['outdir'] = sys.argv[i]
            elif option == '-i':
                i+=1
                _parms['infile'] = sys.argv[i]
            elif option == '-t':
                i+=1
                _parms['tdir'] = sys.argv[i]
            else:
                print "Invalid argument found\n"
                usage()
            i+=1
    except:
        usage()
    
    if (not _parms['infile']):
        print "Need to provide a json fpga register document file through the -i option"
        usage()

    if (not _parms['tdir']):
        print "Need to provide a template directory through the -t option"
        usage()

    if (not _parms['outdir']):
        print "Need to provide an output directory through the -d option"
        usage()

    # Make sure we can write to the desired output path
    if (not os.access(_parms['outdir'], os.W_OK | os.X_OK)):
        print "The directory specified %s does not exist or is not writable" % _parms['outdir']
        sys.exit()

    # Set the current work directory and the templates directory
    wdir = os.path.dirname(os.path.realpath(__file__))
    _parms['cwdir'] = wdir

# Used to print an error message and exit
def die(msg):
    print msg
    sys.exit()


# Does validation of a 'struct' item in the fpga register definition
# The dtype identifies the datatype of the objects defined in the struct
def validateStruct(name, item, dtype):
    # The incoming item must be a dict type
    if not type(item) is list:
        die("Invalid struct item for " + name)
    
    # Go through all the elements in the struct definition
    for sitem in item:
        # Every item must have a member called 'field'
        if not 'field' in sitem:
            die("struct is missing 'field' element for " + name)
        
        if dtype == 'b':
            # The item type is a bit pack
            if not 'size' in sitem:
                die("Struct items for bit packed items must have a size " + name)
            elif not type(sitem['size']) is int:
                die("All size items must be an integer")
        elif dtype == 'packed':
            if not 'data_type' in sitem:
                die("All struct items for packed data type must contain data type elements " + name)
            else:
                # Examine the data type definition
                matches = re.match('^(\d+x)?([bCuviIsSlLnNd])$', sitem['data_type'])
                if not matches:
                    # We have an invalid data type definition
                    die("Invalid data type definition of " + sitem['data_type'] + " for " + name)
                    
                if matches.group(1):
                    # There was a Nx pattern in the data type indicating an array type structure
                    if ('struct' in sitem):
                        # Recursively validate the struct
                        validateStruct(name, sitem['struct'], matches.group(2))
     
        if 'map' in sitem:
            # Check that all map definitions are dict's
            if not type(sitem['map']) in [dict, list]:
                die("All map items must be a hash or array: " + name)
                
            # Can't have a map and a struct at the same level
            if  'struct' in sitem:
                die("Can't have a map and a struct definition at the same level: " + name)
    
    
# Used to check on the 'read' section of an rpga register definition
def checkOidReadDef(name, read):
    if not 'data_type' in read:
        die("Missing data_type in read defintion for rpga register: " + name)

    if ('struct' in read and ('map' in read or 'unit' in read)):
        # This isn't allowed as we can only have a map or unit value for a scalar
        die("We have a map and/or unit definition at the same level as a struct in: " + name)

    if ('map' in read and not type(read['map']) in [dict, list]):
        die("All map items must be a hash or array: " + name)

    if (read['data_type'] == 'packed'):
        # If top level data type is 'packed' we need a struct to further
        # expand on the structure
        if (not 'struct' in read):
            die("For a data type of 'packed' we need a struct definition at the same level: " + name)

        validateStruct(name, read['struct'], 'packed')
    elif read['data_type']:
        # Note that some data_type may be defined as null if we don't expect a response from CM
        matches = re.match('^(\d+x)?([bCuviIsSlLnNd])$', read['data_type'])
        if not matches:
            # We have an invalid data type definition
            die("Invalid data type definition of " + read['data_type'] + " for: " + name)

        if matches.group(1):
            # There was a Nx pattern in the data type indicating an array type structure
            if (matches.group(2) != 'C'):
                # We have array structure and it isn't a string so we should have a struct at this level
                if ('struct' in read):
                    validateStruct(name, read['struct'], matches.group(2))

# Checks on a write component of the oid definition
def checkOidWriteDef(name, write):
    if not 'parms' in write:
        die("write section needs parms array: " + name)
    
    if not type(write['parms']) is list:
        die("write section parms element has to be a list: " + name)
        
    for item in write['parms']:
        if not type(item) is dict:
            die("Write section parms element must contain records: " + name)
            
        if not 'type' in item:
            die("Write section parms element must contain a type element: " + name)
        
        if not item['type'] in ['w1','w2','w4','C']:
            die("Write section parms type " + item['type'] + " is invalid: " + name)
            
        if not 'field' in item:
            die("Write section parms elements must contain a 'field' element: " + name)
            
        if type(item['field']) == list:
            # This is a bit packed item
            for sitem in item['field']:
                if not 'name' in sitem or not type(sitem['name']) in [str, unicode]:
                    die("Invalid or missing name element in field definition for write component of : " + name)
                    
                if not 'size' in sitem or not type(sitem['size']) is int:
                    die("Invalid or missing size element in field definition for write component of : " + name)   
  
                if not 'pos' in sitem or not type(sitem['pos']) is int:
                    die("Invalid or missing pos element in field definition for write component of : " + name)
                    
        elif not type(item['field']) in [str, unicode]:
            # The field element must be a list or a string
            die("Invalid field element in write component of : " + name)
        
        if 'validate' in item:
            if 'enum' in item['validate']:
                if typeof(item['validate']['enum']) != list:
                    die("in validate section of write component, all enum specs must be an array: " + name)
                    
            if 'range' in item['validate']: 
                if not 'default' in item['validate']['range']:
                    die("All validate range sections must have a key of 'default' for " + name)
                
                if not 'min' in item['validate']['range']['default']:
                    die("All validate range sections must have a default key of 'min' for " + name)
                    
                if not 'max' in item['validate']['range']['default']:
                    die("All validate range sections must have a default key of 'max' for " + name)
  
            if 'length' in item['validate']:
                if not 'min' in item['validate']['length']:
                    die("All validate length sections must have a key of 'min' for " + name)
                    
                if not 'max' in item['validate']['length']:
                    die("All validate length sections must have a key of 'max' for " + name)
  

  
# Does validation work to make sure that all the register definitions contain the required 
# fields
def validateOIDDef(jsonDef):
    global valid_states, valid_categories, valid_services, valid_operations
    
    if (not 'oids' in jsonDef):
        die("Missing : oids attribute in json definition")
    
    required = ['oid', 'data_type', 'service', 'description', 'op', 'source', 'request']
    for oid_def in jsonDef['oids']:
        not 'name' in oid_def and die("Missing name in oid definition")
        print "** Checking on %s " % oid_def['name']
        
        for fld in required:
            not fld in oid_def and die ("Missing " + fld + " in " + oid_def['name'])
        
        # Name must be alphanumeric
        if (not re.match('^[a-zA-Z0-9_]+$', oid_def['name'])):
            die("Invalid characters in oid name for " + oid_def['name'])

        if (oid_def['data_type'] and oid_def['data_type'] != 'na' and oid_def['size'] == 0 and oid_def['data_type'] != 'arrayI' and oid_def['data_type'] != 'arrayS'):
            print "Warning %s of data type %s has 0 size" % (oid_def['name'], oid_def['data_type'])
        

# Used to read in and validate the golden oid document.  Note that we will support
# 'C' style comments in the file and in order to do this we will do a couple of passes
# the first pass will be to remove the comments and then we will parse the resulting
# json
def checkOIDDef():
    global _parms, goldenRegisters
 
    # Define a sub function for doing our rexex matches
    def _replacer(match):
        # if the 2nd group (capturing comments) is not None,
        # it means we have captured a non-quoted (real) comment string.
        if match.group(2) is not None:
            return "" # so we will return empty to remove the comment

        else: # otherwise, we will return the 1st group
            return match.group(1) # captured quoted-string

    try:
        # Read the whole file as a long string
        with open(_parms['infile']) as f:
            content = ''.join(f.readlines())

        # print "Just read in %s " % content

        # To support comments in the json file, we stip them out before processing 
        pattern = r"(\".*?\"|\'.*?\')|(/\*.*?\*/|//[^\r\n]*$)"

        # first group captures quoted strings (double or single)
        # second group captures comments (//single-line or /* multi-line */)
        regex = re.compile(pattern, re.MULTILINE|re.DOTALL)

        # Replace any comments in the file before translating
        jsondata = regex.sub(_replacer, content)
        # print "After removing comments we have : %s " % jsondata

        # Decode the json data and call our traversal function to interpret it correctly
        oidData = json.loads(jsondata)
        
    except ValueError as e:
        print('invalid json in file %s: %s' % (_parms['infile'], e))
        sys.exit()

    except Exception as e:
        print "Problems reading in json file %s : %s" % (_parms['infile'], e)
        sys.exit()

    # Save the parsed json into our _parms global
    _parms['oidinfo'] = oidData
    
    print "Traversing the document to replace macros and variables"
    traverseOIDObjects(oidData)
    # validateOIDDef(oidData)
    
    print "OID Definitions validated OK"
    
    # We get here the oid definition is good so we will set our global oidData object
    goldenRegisters = Struct(oidData)


# Goes through all the oid definitions to do macro substitutions as needed
def traverseOIDObjects(oidData):
    # print "Traversing %s" %oidData
    # We are looking for macros which will be defined in strings, so we have to look at all lists
    # and arrays to find strings where there could be macros defined
    if (isinstance(oidData, list)):
        for i in range(0, len(oidData)):
            # If the value is a list or dictionary, we recursively call ourselves for expanding
            element = oidData[i]
            if (isinstance(element, list) or isinstance(element, dict)):
                traverseOIDObjects(element)

            # If the value is a string, we'll check it for macro and parameter expansion
            elif (isinstance(element, basestring)):
                # print "checking to expand on %s" %element
                oidData[i] = expandMacros(element)
                oidData[i] = expandParameter(element)
                # print "checking to expand on %s and got back %s" % (element, oidData[k]) 
    else:
        # Now oidData must be a dictionary
        for k in oidData:
            element = oidData[k]
            if (isinstance(element, list) or isinstance(element, dict)):
                traverseOIDObjects(element)

            # If the value is a string, we'll check it for macro expansion
            elif (isinstance(element, basestring)):
                oidData[k] = expandMacros(element)
                oidData[k] = expandParameter(element)
                # print "checking to expand on %s and got back %s" % (element, oidData[k]) 

# Expands macro parameters that may begin with the $$ character
def expandParameter(parm):
    global _parms
    oidData = _parms['oidinfo']
    
    # print "Expanding %s" % parm
    parts = parm.split('.')
    if (parts[0][:2] == '$$'):
        k = parts[0][2:]
        # print "looking for %s in %s as top level key" % (k, oidData)
        if (k in oidData):
            print "Found %s in oidData" %k
            def getAttr(arr, k):
                if (k in arr):
                    return arr[k]
                die("%s not found in %s" % (k, arr))
            
            sub = oidData[k]
            for i in range(1, len(parts)):
                print "Getting attribute for %s" % parts[i]
                sub = getAttr(sub, parts[i])
            
            return sub
        die("Invalid reference %s" % parm)
    else:
        return parm
    

# Does our macro substitutions in the oid definitions.  We do this by recursively
# going through all the keys in the oid definition.  The argument should be a dictionary
# representing an element in the oid definiton
def expandMacros(elem):
    # print "Looking at %s for macro expansion" % elem
    res = re.search("^\s*##([0-9a-zA-Z_\-]+)\s*\((.*)\)\s*$", elem)
    if (res):
        # print "Found macro %s using parms %s" % (res.group(1,2))
        macro = res.group(1)
        args = []
        if (res.group(2)):
            args = res.group(2).split(',')
            
        # Check on the macro type and process it
        if (res.group(1) == 'length'):
            # print "Processing length"
            return len(expandParameter(args[0]))
        
    return elem
                

# ***********************************************************
# Define template tools
# ***********************************************************

# This will do an exec on python code in template modules
def templateSub(match):
    global goldenRegisters
    
    out = ''
    cmd = "\n\n" + match.group(1) + "\n\n"
    # print "found template of %s " % cmd
    exec cmd
    return out
    
    
def processTemplateFile(fname, outfile):
    print "Processing template file %s to %s" % (fname, outfile)

    # Read the file and extract out the python code snippets
    outf = open(outfile, "wb")
    inf = open(fname, "rb")
    instr = inf.read()
    
    # print "Processing template file of %s" % instr
    robj = re.compile(r'<%dali\s(.*?)%>', re.DOTALL)  
    outf.write(re.sub(robj, templateSub, instr.replace("\r", "")))
    outf.close()
    
def processTemplateDir(indir, outdir):
    print "Processing all templates in %s " % indir
    if not os.path.exists(outdir):
        print "Creating destination dir " + outdir
        os.makedirs(outdir)
    
    for fname in os.listdir(indir):
        if (fname[:1] != '.'):
            infile = indir + '/' + fname
            outfile = outdir + '/' + fname
            if (os.path.isfile(infile)):
                processTemplateFile(infile, outfile)
            elif (os.path.isdir(infile)):
                # recursively process sub dirs
                processTemplateDir(infile, outfile)
        
        
# ***********************************************************
# Main processing section 
# ***********************************************************
    
# parse our command line arguements which may include hints on where device elements
# can be found
parseArgs()

# Read the golden oid json file and validate it
checkOIDDef()

# Process all our template files in their respective directores
processTemplateDir(_parms['tdir'], _parms['outdir'])
