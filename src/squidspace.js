// NOTE: Strict mode is causing problems I can't track down right now. 
// TODO: Find out why this breaks things and fix.
//'use strict'; 


/** The SquidSpace module provides a runtime for a simulated
	scene. It allows you to define a 'world' and will then run
	that world as a simulation using the world's settings and 
	allowing the user to move around it in similar to how they 
	navigate through a real world. 

	In most cases the physics used are simplified, but broadly similar 
	to the real-world. However, some physics parameters may 
	be changed. For example, gravity can be increased or decreased;
	affecting how far you can jump and how fast you move.

	NOTE: This is a PoC version of the module and is intended only
	      to support the Squid Hall project. Later versions may be
	      very different than this one.

	## Some ideas for improvement

	Some options reduce CPU, but degrade the experience. One way to handle this might
	be to have a basic setting for 'low', 'medium', and 'high', where high uses every
	option and low uses the least. We could provide a way to choose the setting on the web
	page, which saves the setting to a cookie and reloads the page. The code would simply
	check the cookie on startup and use the appropriate options based on the setting.

	We need to figure out what is required to support tablets and phones and implement that.

	We need to determine if we want to support gamepads.

	SquidSpace, the associated tooling, and the documentation are copyright Jack William Bell 2020. 
    All other content, including HTML files and 3D assets, are copyright their respective
    authors.
*/


var SquidSpace = function() {

	//
	// Defaults.
	//


	//
	// Some size variables we need for calculations.
	//
	// NOTE: Each unit corresponds to 1 meter, so 1.75 is one and three quarter meters.
	//

	// Debug modes.
	// TODO: Make debug modes dynamic, can turn on and off, and
	// add a public log function with log levels, that logs 
	// to the console based on log level and debug mode.
	var debugCamera = false;

	// This is the NW corner of the arena and the origin for layouts. 
	var floorOriginNW = [0, 0, 0]; 
	var floorSize = [0, 0];
	
	// TODO: Add a SquidSpace-specific config value and pass a copy of 
	//       and pass it 'frozen' to all events and hooks.
	// const temp3 = Object.freeze( {a:3,b:4})
	// temp3.a = 2 // it wont update the value of a, it still have 3
	// temp3.c = 6 // still valid but wont change the object

	// TODO: Move these values into the pack file data.
	var pnlwidth = 1;
	var pnldepth = 0.005;
	var pnlSpacing = pnlwidth + 0.3;
	var tblwidth = 1.8;
	var tbldepth = 0.75;
	var tblheight = 0.05;
	var tblSpacing = tblwidth + 0.02;
	var bmWidth = 1;
	var bmSpacing = bmWidth + 10;

	// TODO: Determine if these belong in the pack file data.
	var norot = 0; // Do not rotate.
	var rot = Math.PI / 2; // Rotate 90 degrees.


	//
	// Module data.
	//


	var textures = {};
	var materials = {};
	var objects = {};

	var prepareHook = undefined;
	var buildHook = undefined;
	var placerHooks = {};
	
	var eventHandlers = {};

	//
	// Helper functions.
	//

	var getValIfKeyInDict = function(key, dict, defaultVal) {
		if ((dict != undefined) && (typeof dict === "object")) {
			if (key in dict) {
				return dict[key];
			}
		}
		
		return defaultVal;
	}

	//
	// Object spec loader.
	//
	
	var objectSpecLoader = function(objDict, scene, onSuccessFunc) {
		for (key in objDict) {
			// Assume failure.
			let success = false;
			
			let obj = undefined;
			let config = undefined;
			let visible = false;
			if (typeof objDict[key]["config"] === "object") {
				config = objDict[key]["config"];
				visible = getValIfKeyInDict("space-object", config, false);
			}
			let builtin = getValIfKeyInDict("builtin", objDict[key], false);
			
			if (builtin) {
				if (typeof objDict[key]["data"] === "object") {
					let data = objDict[key]["data"];
					let tp = getValIfKeyInDict("type", data, "");
					let sz = getValIfKeyInDict("size", data, [1, 1]);
					let pos = getValIfKeyInDict("position", data, [0, 0, 0]);
					let mn = getValIfKeyInDict("material", data, "");
					// TODO: Get material from material list by material name
					//       with a default if not loaded.
					// TODO: Refactor this into calls to object builtin hooks.
					if (tp === "floor") {
						obj = addFloor(pos[0], pos[1], pos[2], sz[0], sz[1], 
										materials.macadam, scene);
						success = true;
					}
					else if (tp === "floorSection") {
						obj = addFloorSection(key, pos[0], pos[2], sz[0], sz[1], 
											materials.marble, scene);
						//addFloorSection("hugos", 15, 15, 10, 15, materials.marble, scene);
						success = true;
					}
					else if (tp === "usercamera") {
						let targetPos = getValIfKeyInDict("target-position", data, [20, 1.6, 20]);
						obj = addCamera(pos[0], pos[1], pos[2], 
										targetPos[0], targetPos[1], targetPos[2], scene);
						success = true;
					}
				}
				else {
					// TODO: Throw Error.
					Console.log("Builtin without data section.")
				}
			}
			else {
				obj = SquidSpace.loadObject(key, objDict[key], scene, function(newMeshes) {
					// Process each mesh.
					for (mesh of newMeshes) {
						if (visible) {
							mesh.isVisible = true;
							mesh.checkCollisions = true;
						}
						else {
							mesh.isVisible = false;
						}
					}
				
					if (typeof onSuccessFunc == "function") onSuccessFunc(newMeshes);
				
					// We are good to go!
					success = true;
				});
			}
			
			if (success && obj !== undefined) {
				// Append the config?
				if (typeof config === "object") {
					obj["config"] = config;
				}
			}			
		}
	}
	
	//
	// Builtins.
	//
	// TODO: Create 'object' builtin hooks. Move these to builtin hooks.
	// 
	// TODO: Create 'texture', 'material', and 'light' builtin hooks. 
	//

	var addFloor = function (x, y, z, w, d, material, scene) {
		// NOTE: This makes the floor origin/size and the layout-based origin/size the same 
		//       so long as both use the same origin and size.
		// IMPORTANT! This function *must* be called before doing any layouts. 

		// Override global origin and size because everything else will calculate from that.
		// IMPORTANT! The origin specifies the point the floor starts from at the NW corner of
		// the arena. All layout offsets are calculated from that point!
		floorOriginNW = [x, y, z]; 
		floorSize = [w, d]; 

		// Calculate offsets.
		x = x + (w / 2);
		z = z - (d / 2);

		// Make the floor.
		let floor = BABYLON.Mesh.CreateGround('floor', w, d, 2, scene);
		floor.position = new BABYLON.Vector3(x, y, z);
	    floor.material = material;
	    //floor.receiveShadows = true; // This seems to increase the CPU requirements by quite a bit.
		floor.checkCollisions = true;

		return floor;
	}


	var addFloorSection = function(secName, x, z, w, d, material, scene) {
		var floorSection = BABYLON.MeshBuilder.CreatePlane(secName, 
												{width: w, height:d}, scene);
		floorSection.position = new SquidSpace.makeLayoutVector(x, 0.001, z, w, d);
		floorSection.rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0);
	    floorSection.material = material;
		floorSection.material.backFaceCulling = false;
		return floorSection;
	}
	
	
	var addCamera = function(x, y, z, targetX, targetY, targetZ, scene) {

		// Add a camera to the scene and attach it to the canvas
		// TODO: Specify camera in world file.
		// TODO: Support switching to VirtualJoysticksCamera if running on a tablet or phone.
		// See https://doc.babylonjs.com/babylon101/cameras#virtual-joysticks-camera
		let camera = new BABYLON.UniversalCamera("usercamera", 
												SquidSpace.makePointVector(x, y, x), scene);
		//var camera = new BABYLON.FreeCamera("default camera", new BABYLON.Vector3(0, 5, -10), scene);
		//var camera = new BABYLON.FlyCamera("default camera", new BABYLON.Vector3(0, 5, -10), scene);
		camera.setTarget(new SquidSpace.makePointVector(targetX, targetY, targetZ));
		camera.attachControl(canvas, true);

		//
		// Enable walking.
		// TODO: Specify the options in world file, add support code to squidspace.js
		//

		// Set the ellipsoid around the camera for collision detection.
		// TODO: Experiment with values to find best.
		// TODO: Consider making pack file settable.
		// NOTE: ellipsoid values must be carefully chosen to reduce image tearing when
		//       up close to objects, while still allowing you to navigate around without
		//       getting stuck between things. However, this does mean you can't get really
		//       close to anything straight in front of you.
		camera.ellipsoid = new BABYLON.Vector3(1, 1, 1);

		// WASD movement.
	    camera.keysUp.push(87);    //W
	    camera.keysDown.push(83)   //D
	    camera.keysLeft.push(65);  //A
	    camera.keysRight.push(68); //S

		// Support gamepad.
		//camera.inputs.add(new BABYLON.FreeCameraGamepadInput());
		//camera.inputs.attached.gamepad.gamepadAngularSensibility = 250;

		// Apply collisions and gravity to the active camera
		camera.checkCollisions = true;
		camera.applyGravity = true;

		// Other camera settings.
		// TODO: Experiment with values to find best.
		// TODO: Consider making pack file settable or even dynamically settable.
		camera.fov = 1.3;
		if (!debugCamera) {
			//camera.speed = 0.15; // Lower values slow movement down.
			camera.speed = 0.20;
			//camera.speed = 0.25; .
			//camera.speed = 0.55; 
		    //camera.inertia = 0.2; // Lower values slow movement down, but also affect look/turning.
			//camera.inertia = 0.4;
			//camera.inertia = 0.6;
			camera.inertia = 0.8;
			//camera.inertia = 1; // DO NOT USE - you will not like it.
			//camera.angularSensibility = 500; // Lower values increase look/turning speed, default is 2000.
			camera.angularSensibility = 750;
			//camera.angularSensibility = 1000;
		}
		
		return camera;
	}
	
	
	// TODO: Spec loaders for materials, lights, etc.
	

	//
	// Layout spec loader.
	//

	var layoutSpecLoader = function(layoutsList, scene) {
		for (layout of layoutsList) {
			let areaName = getValIfKeyInDict("area", layout, "");
			let areaOrigin = getValIfKeyInDict("origin", layout, [0,0,0]);
			let config = undefined;
			if (typeof layout["config"] === "object") {
				config = layout["config"];
			}

			// DEBUG: Comment out for production.
			console.log(`layoutSpecLoader: ${areaName}`);
			
			for (placement of layout["object-placements"]) {
				let placeName =  getValIfKeyInDict("name", placement, "");
				let placer = getValIfKeyInDict("placer", placement, "");
				let objName = getValIfKeyInDict("object", placement, "");
				let data = getValIfKeyInDict("data", placement, {});
				
				// DEBUG: Comment out for production.
				console.log(`layoutSpecLoader placement: ${placeName}/${placer}/${objName}`);
				
				// Do we have a valid object name?
				if (objName in objects || objName === "_none_") {
					
					// Is the placer hooked?
					if (placer in placerHooks) {
						// Try to get the meshes.
						let meshes = SquidSpace.getLoadedObjectMeshes(objName);
						// TODO: Wrap with try/catch.
						placerHooks[placer](areaName, areaOrigin, config, placeName, 
											data, objName, meshes, scene);
					}
					else {
						// TODO: Consider making these 'builtin hooks' that
						//       can be overridden.
						let position = getValIfKeyInDict("position", data, 0);
						let rotation = norot;
						if (getValIfKeyInDict("rotation", data, false)) {
							rotation = rot;
						}
   						let plc = [];
	   					if (placer == "linear-series") {
							let count = getValIfKeyInDict("count", data, 1);
							let across = getValIfKeyInDict("across", data, true);
							let offset = getValIfKeyInDict("offset", data, 0);
							// TODO: Placements currently do not include 'y'.
	   						SquidSpace.addLinearSeriesToPlacements(
	   							placeName, plc, count, position[0], position[2], 
								offset, across, rotation);
	   					}
	   					else if (placer == "rectangle-series") {
							let countWide = getValIfKeyInDict("countWide", data, 1);
							let countDeep = getValIfKeyInDict("countDeep", data, 1);
							let lengthOffset = getValIfKeyInDict("lengthOffset", data, 0);
							let widthOffset = getValIfKeyInDict("widthOffset", data, 0);
							// TODO: Placements currently do not include 'y'.
	   						SquidSpace.addRectangleSeriesToPlacements(
								placeName, plc, countWide, countDeep, position[0], position[2], 
								lengthOffset, widthOffset);
	   					}
	   					else if (placer == "single") {
							// TODO: Placements currently do not include 'y'.
	   						SquidSpace.addSingleInstanceToPlacements(
								placeName, plc, position[0], position[2], rotation);
	   					}
	   					else {
							// TODO: Throw exception or otherwise handle. (Log?)
	   					}
						
						// DEBUG: Comment out for production.
						console.log(`layoutSpecLoader placer count: ${plc.length}`);
						
						if (plc.length > 0) {
							SquidSpace.placeObjectInstances(objName, plc, undefined, scene);
						}
					}					
				}
				else {
					// TODO: Throw exception or otherwise handle. (Log?)
				}					
			}
		}
	}
	
	
	//
	// Layout Placers.
	//
	
	// TODO: Implement.

	
	return {
		//
		// Public helper functions.
		//

		/** Returns an array of points in the form [x, y, z], where the points are 
		    calculated from the passed points using the following rules:

			1. x and z are normalized from the floor origin point, located in the 
		       NW corner of the floor
		 */
		makePointXYX: function(x, y, z) {
			// TODO: This function was created because I don't understand how Babylon
			//       does local vectors and was under time pressure, so couldn't do the
			//       research. At some point we need to use the BJS code instead, but could
			//       just insert it here without breaking dependent code.
			// IMPORTANT! The origin specifies the point the floor starts from at the NW corner of
			// the arena. All layout offsets are calculated from that point!

			return [
				floorOriginNW[0] + x, 
				floorOriginNW[1] + y, 
				floorOriginNW[2] + (z * -1)
			];
		},
		
		/** Returns an array of points in the form [x, y, z], where the points are 
		    calculated from the passed points using the following rules:
			
			1. x and z are normalized from the floor origin point, located in the 
		       NW corner of the floor
		
			2. x and z are further normalized to the NW corner of the rectangle 
		       specified by w and d
		 */
		makeLayoutXYZ: function(x, y, z, w, d) {
			// TODO: This function was created because I don't understand how Babylon
			//       does local vectors and was under time pressure, so couldn't do the
			//       research. At some point we need to use the BJS code instead, but could
			//       just insert it here without breaking dependent code.
			// IMPORTANT! The origin specifies the point the floor starts from at the NW corner of
			// the arena. All layout offsets are calculated from that point!

			return [
				floorOriginNW[0] + x + (w / 2), 
				floorOriginNW[1] + y, 
				floorOriginNW[2] + (z * -1) - (d / 2)
			];
		},


		/** Returns a Babylon Vector, where the points are 
		    calculated from the passed points using the following rules:
	
			1. x and z are normalized from the floor origin point, located in the 
		       NW corner of the floor
		 */
		makePointVector: function(x, y, z) {
			// TODO: This function was created because I don't understand how Babylon
			//       does local vectors and was under time pressure, so couldn't do the
			//       research. At some point we need to use the BJS code instead, but could
			//       just insert it here without breaking dependent code.
			// IMPORTANT! The origin specifies the point the floor starts from at the NW corner of
			// the arena. All layout offsets are calculated from that point!

			return new BABYLON.Vector3(
				floorOriginNW[0] + x, 
				floorOriginNW[1] + y, 
				floorOriginNW[2] + (z * -1)
			);
		},


		/** Returns Babylon Vector, where the points are 
		    calculated from the passed points using the following rules:
		
			1. x and z are normalized from the floor origin point, located in the 
		       NW corner of the floor
	
			2. x and z are further normalized to the NW corner of the rectangle 
		       specified by w and d
		 */
		makeLayoutVector: function(x, y, z, w, d) {
			// TODO: This function was created because I don't understand how Babylon
			//       does local vectors and was under time pressure, so couldn't do the
			//       research. At some point we need to use the BJS code instead, but could
			//       just insert it here without breaking dependent code.
			// IMPORTANT! The origin specifies the point the floor starts from at the NW corner of
			// the arena. All layout offsets are calculated from that point!

			return new BABYLON.Vector3(
				floorOriginNW[0] + x + (w / 2), 
				floorOriginNW[1] + y, 
				floorOriginNW[2] + (z * -1) - (d / 2)
			);
		},

		// TODO: Texture/Material/Light management functions.

		//
		// Object management functions.
		//
		

		/** Loads the named object using the passed object data. Calls the passed success
		    function if the object is loaded. Adds the object to the internal list, making
		    it available to the getLoadedObjectMeshes() function. Returns the loaded object
		    or 'undefined'. 
		
		    The object data is a dictionary with the same structure as pack file object
		    data. 
		 */
		loadObject: function(objName, objData, scene, onSuccessFunc) {
			let obj = undefined;
			
			// Note: You can add this ImportMesh() argument to force a specific 
			//       loader plugin by file type. 
			let loaderPluginExtension = null;
			//let loaderPluginExtension = ".obj"; // Force obj file loader plugin.

			// File Root arg.
			let fr = "";
			if ("root" in objData) {
				fr = objData["root"];
			}

			// File Name arg.
			let fn = null;
			if ("file" in objData) {
				fn = objData["file"];
			}
			else if ("data" in objData) {
				fn = "data:" + objData["data"];
			}
			else {
				// TODO: Throw exception.
			}

			let meshNameFilter = ""; // Empty string means import *all* meshes in the object.

			obj = BABYLON.SceneLoader.ImportMesh(meshNameFilter, fr, fn, scene, 
					function(newMeshes) {
						if (debugVerbose) console.log("'" + objName + 
							"' mesh import suceeded. Mesh count: " + newMeshes.length);
						
						// Save the meshes for later.
						SquidSpace.addObjectInstance(objName, newMeshes);
			
						if (typeof onSuccessFunc == "function") onSuccessFunc(newMeshes);
					}, null,
					function(scene, message, exception) {
						console.log("== '" + objName + 
							"' mesh import failed. ==\n  Message: " + 
							message.substring(0, 64) + " ... " +  message.substring(message.length - 64) +
							"\n  Exception: " + exception);
					}, 
					loaderPluginExtension); 
			
			// Done.
			return obj;
		},
		
		
		/** Makes a cloned copy of the object for the passed object name, assinging the 
		    passed clone object name to the new object. Returns the cloned meshes or 
		    'undefined' if it fails. */
		cloneObject: function(objName, cloneObjName) {
			let meshes = SquidSpace.getLoadedObjectMeshes(objName);
			let clone = [];
			
			// If we have meshes, clone them.
			if (typeof meshes != "undefined") {
				for (m of meshes) {
					clone.push(m.clone(cloneObjName));
				}
			}

			// Did we get anything?
			if (clone.length > 0) {
				// Add the cloned object to the internal list.
				SquidSpace.addObjectInstance(cloneObjName, clone);
				
				// We are good!
				return clone;
			}
			
			return undefined;
		},

		
		addObjectInstance: function(objName, meshes) {
			// Force ID of all meshes to the object name.
			for (m of meshes) {
				m.id = objName;
			}
			
			// TODO: Check if objName already exists. Decide how to handle. (Error?)
			
			// Keep a local reference to the object.
			objects[objName] = meshes;
		},
		
		
		/** Returns the meshes for the passed object name, assuming the object was 
		specified in the pack file, loaded with the loadObject(), cloned with cloneObject,
		or added with the addObject() function. If the object is available it returns 
		an array of meshes for the object. If it was not it returns 'undefined'. */
		getLoadedObjectMeshes: function(objName) {
			if (objName in objects) {
				return objects[objName];
			}
			
			return undefined;
		},
		
		
		//
		// Layout helper functions.
		//

	
		/** Adds a single instance to a placements array at the passed position
		    and rotation.
		
		    TODO: Support y.
		
		    TODO: Currently only supports horizontally aligned placements, add ability 
		    to do vertical.
		 */
		addSingleInstanceToPlacements: function(instanceName, placements, x, z, rotation) {
			placements.push([instanceName, x, z, rotation]);
		},
	
	
		/** Adds a count series of placements elements to an existing placements array, 
			starting at the the provided x and z and separated by the provided offset. If 
			across is true the elements start at the west and go east. Otherwise the elements
			start at the south and go north. The passed rotation is used for all elements
			in the series.
		
		    TODO: Support y.
		
		    TODO: Currently only supports horizontally aligned placements, add ability 
		    to do vertical.
		*/
		addLinearSeriesToPlacements: function(seriesName, placements, count, x, z, offset,
												across, rotation) {
			for (let i = 0;i < count;i++) {
				placements.push([seriesName + i, x, z, rotation])
				if (across) {
					x += offset;
				}
				else {
					z += offset;
				}
			}
		},


		/** Adds a count wide and count deep series of placements elements to an 
		    existing placements array in the form of a rectangle, 
			starting at the the provided x and z and separated by the provided offsets. 
		    The passed rotation is used for all elements in the series.
		
		    TODO: Support y.
		
		    TODO: Currently only supports horizontally aligned placements, add ability 
		    to do vertical.
		
		    TODO: Currently only supports horizontally aligned placements, add ability 
		    to do vertical.
		*/
		addRectangleSeriesToPlacements: function(seriesName, placements, countWide, countDeep,
													x, z, lengthOffset, widthOffset) {
			// Calculate starting positions.
			let wx = x + widthOffset;
			let bz = z + (countDeep * lengthOffset) - widthOffset;
			let rx = x + (countWide * lengthOffset) - lengthOffset;

			// Do width placements.
			for (let i = 0;i < countWide;i++) {
				SquidSpace.addLinearSeriesToPlacements(seriesName + "-top-", placements, 
													countWide, wx, z, lengthOffset, true, norot);
				SquidSpace.addLinearSeriesToPlacements(seriesName + "-bottom-", placements, 
													countWide, wx, bz, lengthOffset, true, norot);
			}

			// Do depth placements.
			for (let i = 0;i< countDeep;i++) {
				SquidSpace.addLinearSeriesToPlacements(seriesName + "-left-", placements, 
								countDeep, x - lengthOffset, z + lengthOffset, lengthOffset, false, rot);
				SquidSpace.addLinearSeriesToPlacements(seriesName + "-right-", placements, 
								countDeep, rx, z + lengthOffset, lengthOffset, false, rot);
			}
		},

		/** Places instances of the object referred to by object name (string) using 
		    the passed material name (string, null or undefined), using the locations and 
		    rotations specified in the passed placements array.
		
			TODO: Material not currently supported. Consider removing it, since it isn't
		          clear which mesh would get the material. (All meshes in object?)
		 */
		placeObjectInstances: function(objName, placements, matName, scene) {
			// Get the meshes.
			let meshes = SquidSpace.getLoadedObjectMeshes(objName);
			if ((typeof meshes != "object") && !(meshes instanceof Array) && (meshes.length < 1))
				 throw `Mesh not loaded for object reference: ''${objName}''.`;
		
			for (instance of placements) {
				let newMeshes = [];
				for (mesh of meshes) {
					// Create an instance and add it to the new meshes.
					let m = mesh.createInstance(instance[0]);
					newMeshes.push(m);
					
					// Set placement values.
					m.position = SquidSpace.makeLayoutVector(
										instance[1], 0.01, instance[2], m.scaling.x, m.scaling.y);
					if (placements[3] != 0) {
						m.rotate(BABYLON.Axis.Y, instance[3]);
						m.position.z -= (pnlwidth / 2);
					}
					
					// Set other values.
					// TODO: Do we want to add these to placement somehow?
					m.checkCollisions = true;
					m.visible = true;
					// TODO: Fix this. IMPORTANT!
					//let bv = m.getBoundingInfo().boundingBox.minimum;
				}
				SquidSpace.addObjectInstance(instance[0], newMeshes);			
			}
		},


		//
		// Hooks.
		//
		
		
	 	/** The prepareHook is called at the end of prepareWorld() processing
		    to add builtin 3D content or do other things to the scene in 
		    preparation for building the world.
		
		    Signature: hookFunction(scene)
		 */
		attachPrepareHook: function(hookFunction) {
			let oldHook = prepareHook;
			prepareHook = hookFunction;
			return oldHook;
		},
		
	 	/** The prepareHook is called at the end of buildWorld() processing
		    to add extra 3D content, attach events or do other things to the scene in 
		    preparation for running the world.
		
		    Signature: hookFunction(scene)
		 */
		attachBuildHook: function(hookFunction) {
			let oldHook = prepareHook;
			buildHook = hookFunction;
			return oldHook;
		},
		
	 	/** The PlacerHook is called by name during layout processing to perform complex
		    or custom object placements.
		
		    Signature: hookFunction(areaName, areaOrigin, config, placeName, data, 
		                            objName, meshes, scene)
		 */
		attachPlacerHook: function(hookName, hookFunction) {
			let oldHook = placerHooks[hookName];
			placerHooks[hookName] = hookFunction;
			return oldHook;
		},
		

		//
		// Events.
		//

		
		attachClickEventToObject: function(objName, eventName, eventData, scene) {
			meshes = SquidSpace.getLoadedObjectMeshes(objName);
			
			if (typeof meshes != "undefined") {
				for (mesh of meshes) {
					// TODO: Wrap with try-catch and then raise custom error or log or something.
					mesh.actionManager = new BABYLON.ActionManager(scene);
					mesh.actionManager.registerAction(
						new BABYLON.ExecuteCodeAction(
							{
								trigger: BABYLON.ActionManager.OnPickTrigger
							},
							function () {SquidSpace.fireOnClickEvent(eventName, objName, eventData);}
						),
					);
				}
			}
			else {
				// TODO: error or log or something.
			}
		},
		
		
		fireOnClickEvent: function(eventName, sourceObjectName, eventData) {
			if (eventName in eventHandlers) {
				for (hdlr of eventHandlers[eventName]) {
					hdlr(sourceObjectName, eventData);
				}
			}
		},
		

		addEventHandler: function(eventName, handlerFunc) {
			if (!(eventName in eventHandlers)) {
				// Initialize the event name with an empty array.
				eventHandlers[eventName] = [];
			}
			
			// Add the event to the array.
			eventHandlers[eventName].push(handlerFunc);
		},
		
		
		// TODO: Remove event handler.
		
		
		//
		// Public scene management functions.
		//
		
		
		/** PoC-specific function to add Babylon.js built-ins and do other setup. */
		prepareWorld: function(scene, debugVerbose, debugLayer) {
			
			if (debugVerbose) {
				// TODO: Improve debug handling.
				// TODO: Either make this optional or move it to a hook.
				// Log plugin activations.
				BABYLON.SceneLoader.OnPluginActivatedObservable.add(function (plugin) {
				    console.log(`Plugin Activated: ${plugin.name}`);
				});
			}
		
			// Turn on optimizaton.
			// TODO: Either make these optional or move them to a hook.
			var options = new BABYLON.SceneOptimizerOptions();
			options.addOptimization(new BABYLON.HardwareScalingOptimization(0, 1));
			/* Set Degredation Level - TODO: Come up with a way to make this user settable.
			BABYLON.SceneOptimizerOptions.LowDegradationAllowed()  
			BABYLON.SceneOptimizerOptions.ModerateDegradationAllowed()  
			BABYLON.SceneOptimizerOptions.HighDegradationAllowed() 
			*/
			options.addOptimization(new BABYLON.SceneOptimizerOptions.ModerateDegradationAllowed());
			var optimizer = new BABYLON.SceneOptimizer(scene, options);
			optimizer.targetFrameRate = 40 // TODO: Come up with a way to make this user settable.
			if (debugVerbose) {
				console.log(`Optimizer target framerate: ${optimizer.targetFrameRate}`)
				optimizer.onSuccessObservable = new function() {
					console.log("Optimizer 'success'.")
				}
				optimizer.onNewOptimizationAppliedObservable = new function() {
					console.log("New optimization applied.")
				}
				optimizer.onFailureObservable = new function() {
					console.log(`Optimizer unable to reach target framerate: ${optimizer.targetFrameRate}`)
				}
			}
			//optimizer.start(); // Don't need?

			// TODO: Make this dynamic somehow.
			// TODO: Either make this optional or move it to a hook.
			if (debugLayer) scene.debugLayer.show();
			
		
			// Add some procedural materials  we'll be using as 'builtins' to the scene.
			// TODO: Add texture and material code to SquidSpace and either move these to 
			//       squidhall.js or to a pack file.
			// TODO: Determine if we want to use ambient or diffuse textures. Currently using
			//       ambient on marble and diffuse on macadam. See:
			// * https://gamedev.stackexchange.com/questions/14334/the-difference-between-diffuse-texture-and-ambient-occlusion-texture
			// * https://www.quora.com/What-is-the-difference-between-Ambient-Diffuse-and-Specular-Light-in-OpenGL-Figures-for-illustration-are-encouraged?share=1
		    materials.macadam = new BABYLON.StandardMaterial("macadam", scene);
		    textures.macadam = new BABYLON.RoadProceduralTexture("macadamtext", 2048, scene);
			materials.macadam.backFaceCulling = false;
		    materials.macadam.diffuseTexture = textures.macadam;
		    materials.marble = new BABYLON.StandardMaterial("marble", scene);
		    textures.marble = new BABYLON.MarbleProceduralTexture("marbletext", 512, scene);
		    materials.marble.ambientTexture = textures.marble;
		    //materials.marble.numberOfBricksHeight = 1; // Doesn't seem to do anything?
		    //materials.marble.numberOfBricksWidth = 1; // Doesn't seem to do anything?
		    materials.wood = new BABYLON.StandardMaterial("wood", scene);
		    textures.wood = new BABYLON.WoodProceduralTexture("woodtext", 1048, scene);
			textures.wood.ampScale = 256; // TODO: Experiment with this, read docs again.
			textures.wood.woodColor = new BABYLON.Color3(0.8, 0.8, 0.8);
			materials.wood.backFaceCulling = false;
		    materials.wood.diffuseTexture = textures.wood;
			
			// Call prepare hook.
			// TODO: try/catch.
			prepareHook(scene);
		},
	
		/** PoC-specific function to load the passed scene from the world 
		    and content specs. 
		*/
		buildWorld: function(worldSpec, contentSpecs, scene, debugVerbose) {
			// Assume success.
			let success = true;
		 
			debugCamera = debugVerbose;
			if (debugVerbose) {
				//showWorldAxis(10)
			}
		 
			// Verify inputs.
			// TODO: Add other validation checks, such as object
			//       member validation.
			if (typeof debugVerbose === "undefined") {
				// Default to true.
				debugVerbose = false;
			}
			if (typeof worldSpec != "object") {
				// World spec is required.
				success = false;
			}
			if ((typeof contentSpecs != "object") && !(contentSpecs instanceof Array)) {
				// Default to empty list.
				contentSpecs = [];
			}
			if (typeof scene != "object") {
				// Scene is required.
				success = false;
			}
		
			// Are we OK to continue?
			if (!success) {
				return success;
			}
						
			// Create world from spec.
			// TODO: material, lights, etc. spec loaders. Textures should be first,
			// layouts should be last.	
			objectSpecLoader(getValIfKeyInDict("objects", worldSpec, {}), scene, null);
			layoutSpecLoader(getValIfKeyInDict("layouts", worldSpec, []), scene);
			for (spec of contentSpecs) {
				objectSpecLoader(getValIfKeyInDict("objects", spec, {}), scene, null);
				layoutSpecLoader(getValIfKeyInDict("layouts", spec, []), scene);
			}

			// Set gravity for the scene (G force on Y-axis)
			// See https://doc.babylonjs.com/babylon101/cameras,_mesh_collisions_and_gravity
			// TODO: Determine best settings here.
			if (debugVerbose) {
				// TODO: Give this it's own argument instead of debugVerbose.
				// Allow user to fly.
				scene.gravity = new BABYLON.Vector3(0, 0, 0); 
			}
			else {
				// User walks on ground.
				// TODO: Configure from pack file?
				scene.gravity = new BABYLON.Vector3(0, -0.9, 0);
			}

			// Enable Collisions for scene.
			scene.collisionsEnabled = true;
			
			// Call build hook.
			// TODO: try/catch.
			buildHook(scene);

			// Done.
			return success;
		}
	}
}();