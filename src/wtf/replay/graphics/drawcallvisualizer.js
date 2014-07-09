/**
 * Copyright 2014 Google, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

/**
 * @fileoverview DrawCallVisualizer. Abstract Visualizer that uses draw calls.
 *
 * @author scotttodd@google.com (Scott Todd)
 */

goog.provide('wtf.replay.graphics.DrawCallVisualizer');

goog.require('goog.asserts');
goog.require('goog.webgl');
goog.require('wtf.replay.graphics.OffscreenSurface');
goog.require('wtf.replay.graphics.Playback');
goog.require('wtf.replay.graphics.Visualizer');
goog.require('wtf.replay.graphics.WebGLState');



/**
 * Abstract class for a Visualizer that operates on draw calls.
 *
 * @param {!wtf.replay.graphics.Playback} playback The playback instance.
 * @constructor
 * @extends {wtf.replay.graphics.Visualizer}
 */
wtf.replay.graphics.DrawCallVisualizer = function(playback) {
  goog.base(this, playback);

  /**
   * A mapping of handles to contexts.
   * Keys are context handles from event arguments.
   * @type {!Object.<!WebGLRenderingContext>}
   * @protected
   */
  this.contexts = {};

  /**
   * A mapping of handles to Programs.
   * Keys are program handles from event arguments.
   * @type {!Object.<!wtf.replay.graphics.Program>}
   * @protected
   */
  this.programs = {};

  /**
   * Surfaces for playback state, mapping of handles to OffscreenSurfaces.
   * Keys are context handles from event arguments.
   * @type {!Object.<!wtf.replay.graphics.OffscreenSurface>}
   * @protected
   */
  this.playbackSurfaces = {};

  /**
   * Surfaces for visualization, mapping of handles to OffscreenSurfaces.
   * Keys are context handles from event arguments.
   * @type {!Object.<!wtf.replay.graphics.OffscreenSurface>}
   * @protected
   */
  this.visualizerSurfaces = {};

  /**
   * WebGLStates for backup/restore, mapping of handles to WebGLStates.
   * Keys are context handles from event arguments.
   * @type {!Object.<!wtf.replay.graphics.WebGLState>}
   * @protected
   */
  this.webGLStates = {};

  /**
   * Whether this Visualizer is completed and can call restoreState
   * before the next event.
   * @type {boolean}
   * @protected
   */
  this.completed = false;

  /**
   * Whether draw calls should be modified.
   * @type {boolean}
   * @protected
   */
  this.modifyDraws = false;

  /**
   * The current context handle from event arguments.
   * @type {?number}
   * @protected
   */
  this.latestContextHandle = null;

  /**
   * The program handle from event arguments for the latest used program.
   * @type {number}
   * @protected
   */
  this.latestProgramHandle = 0;

  playback.addListener(wtf.replay.graphics.Playback.EventType.CLEAR_PROGRAMS,
      this.clearPrograms_, this);

  this.mutators['wtf.webgl#setContext'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          // Track contexts, update dimensions to match context parameters.
          var contextHandle = args['handle'];
          var height = args['height'];
          var width = args['width'];

          if (visualizer.contexts[contextHandle]) {
            visualizer.playbackSurfaces[contextHandle].resize(width, height);
            visualizer.visualizerSurfaces[contextHandle].resize(width, height);
          } else {
            visualizer.contexts[contextHandle] = gl;

            var playbackSurface = new wtf.replay.graphics.OffscreenSurface(gl,
                width, height);
            visualizer.playbackSurfaces[contextHandle] = playbackSurface;
            visualizer.registerDisposable(playbackSurface);

            visualizer.createSurface(contextHandle, gl, width, height);

            var webGLState = new wtf.replay.graphics.WebGLState(gl);
            visualizer.webGLStates[contextHandle] = webGLState;
          }

          visualizer.latestContextHandle = contextHandle;
        }
      });

  this.mutators['WebGLRenderingContext#linkProgram'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          // Create variant programs whenever a program is linked.
          var programHandle = /** @type {number} */ (args['program']);
          var originalProgram = /** @type {WebGLProgram} */ (
              visualizer.playback.getObject(programHandle));
          goog.asserts.assert(originalProgram);

          // Programs can be linked multiple times. Avoid leaking objects.
          if (visualizer.programs[programHandle]) {
            visualizer.deleteProgram_(programHandle);
          }

          visualizer.createProgram(programHandle, originalProgram, gl);
        }
      });

  this.mutators['WebGLRenderingContext#useProgram'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          visualizer.latestProgramHandle = args['program'];
        }
      });

  this.mutators['WebGLRenderingContext#deleteProgram'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          visualizer.deleteProgram_(args['program']);
        }
      });

  this.mutators['WebGLRenderingContext#drawArrays'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          visualizer.handleDrawCall(function() {
            gl.drawArrays(
                args['mode'], args['first'], args['count']);
          });
        }
      });

  this.mutators['WebGLRenderingContext#drawElements'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          visualizer.handleDrawCall(function() {
            gl.drawElements(
                args['mode'], args['count'], args['type'],
                args['offset']);
          });
        }
      });

  this.mutators['ANGLEInstancedArrays#drawArraysInstancedANGLE'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          var ext = gl.getExtension('ANGLE_instanced_arrays');
          visualizer.handleDrawCall(function() {
            ext['drawArraysInstancedANGLE'](
                args['mode'], args['first'], args['count'], args['primcount']);
          });
        }
      });

  this.mutators['ANGLEInstancedArrays#drawElementsInstancedANGLE'] = /** @type
    {wtf.replay.graphics.Visualizer.Mutator} */ ({
        post: function(visualizer, gl, args) {
          var ext = gl.getExtension('ANGLE_instanced_arrays');
          visualizer.handleDrawCall(function() {
            ext['drawElementsInstancedANGLE'](
                args['mode'], args['count'], args['type'], args['offset'],
                args['primcount']);
          });
        }
      });
};
goog.inherits(wtf.replay.graphics.DrawCallVisualizer,
    wtf.replay.graphics.Visualizer);


/**
 * Handles operations that should occur before the provided event.
 * @param {!wtf.db.EventIterator} it Event iterator.
 * @param {WebGLRenderingContext} gl The context.
 * @override
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.handlePreEvent = function(
    it, gl) {
  if (this.completed) {
    this.restoreState();
  }

  goog.base(this, 'handlePreEvent', it, gl);
};


/**
 * Creates an OffscreenSurface and adds it to this.visualizerSurfaces.
 * @param {number|string} contextHandle Context handle from event arguments.
 * @param {!WebGLRenderingContext} gl The context.
 * @param {number} width The width of the surface.
 * @param {number} height The height of the surface.
 * @protected
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.createSurface = function(
    contextHandle, gl, width, height) {
  var visualizerSurface = new wtf.replay.graphics.OffscreenSurface(gl,
      width, height, {stencil: true});
  this.visualizerSurfaces[contextHandle] = visualizerSurface;
  this.registerDisposable(visualizerSurface);
};


/**
 * Deletes the specified program.
 * @param {number|string} programHandle Program handle from event arguments.
 * @private
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.deleteProgram_ = function(
    programHandle) {
  goog.dispose(this.programs[programHandle]);
  delete this.programs[programHandle];
};


/**
 * Deletes all stored programs.
 * @private
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.clearPrograms_ = function() {
  for (var programHandle in this.programs) {
    this.deleteProgram_(programHandle);
  }
};


/**
 * Create a Program with variants for originalProgram.
 * @param {number} programHandle Program handle from event arguments.
 * @param {!WebGLProgram} originalProgram The original program.
 * @param {!WebGLRenderingContext} gl The associated rendering context.
 * @protected
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.createProgram =
    goog.nullFunction;


/**
 * Handles performing a draw call and any additional logic.
 * @param {function()} drawFunction The draw function to call.
 * @protected
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.handleDrawCall =
    goog.nullFunction;


/**
 * Runs visualization, manipulating playback and surfaces as needed.
 * @param {Object.<string, !Object>=} opt_args Visualizer trigger arguments.
 * @override
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.trigger = goog.nullFunction;


/**
 * Prepares surfaces for use in a visualization run.
 * @protected
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.setupSurfaces = function() {
  for (var handle in this.visualizerSurfaces) {
    this.visualizerSurfaces[handle].clear([0.0, 0.0, 0.0, 0.0]);
  }
};


/**
 * Restores state back to standard playback.
 */
wtf.replay.graphics.DrawCallVisualizer.prototype.restoreState = function() {
  // Draw playback surfaces to the visible framebuffers.
  for (var contextHandle in this.contexts) {
    var gl = this.contexts[contextHandle];
    var originalFramebuffer = /** @type {WebGLFramebuffer} */ (
        gl.getParameter(goog.webgl.FRAMEBUFFER_BINDING));
    gl.bindFramebuffer(goog.webgl.FRAMEBUFFER, null);

    this.playbackSurfaces[contextHandle].drawTexture();

    gl.bindFramebuffer(goog.webgl.FRAMEBUFFER, originalFramebuffer);

    this.playback.changeContextMessage(contextHandle, ' ');
  }

  this.active = false;
  this.modifyDraws = false;
  this.completed = false;
};
