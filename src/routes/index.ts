import { Router } from 'express';

import Paths from '@src/common/Paths';
import UserRoutes from './UserRoutes';
import GoogleDriveRoutes from './GoogleDriveRoutes';
import GSMRoutes from './GSMRoutes';
import VideoRoutes from './VideoRoutes';
import TriggerRoutes from './TriggerRoutes';

/******************************************************************************
                                Variables
******************************************************************************/

const apiRouter = Router();

// ** Add UserRouter ** //

// Init router
const userRouter = Router();

// Get all users
userRouter.get(Paths.Users.Get, UserRoutes.getAll);
userRouter.post(Paths.Users.Add, UserRoutes.add);
userRouter.put(Paths.Users.Update, UserRoutes.update);
userRouter.delete(Paths.Users.Delete, UserRoutes.delete);

// Add UserRouter
apiRouter.use(Paths.Users.Base, userRouter);

// ** Add GoogleDriveRouter ** //
apiRouter.use(Paths.GoogleDrive.Base, GoogleDriveRoutes);

// ** Add GSMRouter ** //
apiRouter.use(Paths.GSM.Base, GSMRoutes);

// ** Add VideoRouter ** //
apiRouter.use(Paths.Video.Base, VideoRoutes);

// ** Add TriggerRouter ** //
apiRouter.use(Paths.Trigger.Base, TriggerRoutes);

/******************************************************************************
                                Export default
******************************************************************************/

export default apiRouter;